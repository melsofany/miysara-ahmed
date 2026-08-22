import { Router } from 'express';
import db from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { badRequest } from '../middleware/audit.js';

const router = Router();

function dateRange(req) {
  const { from, to, period } = req.query;
  const today = new Date().toLocaleDateString('en-CA');
  let f = from, t = to;
  if (period === 'today') { f = today; t = today; }
  else if (period === 'yesterday') { const d = new Date(Date.now() - 864e5).toLocaleDateString('en-CA'); f = d; t = d; }
  else if (period === 'week') { const d = new Date(Date.now() - 6 * 864e5).toLocaleDateString('en-CA'); f = d; t = today; }
  else if (period === 'month') { f = today.slice(0, 8) + '01'; t = today; }
  f = f || '2000-01-01'; t = t || '2100-01-01';
  return { from: f + ' 00:00:00', to: t + ' 23:59:59', f, t };
}

function posScope(req, sql, args, col = 'i.pos_location_id') {
  if (req.user.posIds.length) { sql += ` AND ${col} IN (${req.user.posIds.map(() => '?').join(',')})`; args.push(...req.user.posIds); }
  return sql;
}

// ---------- لوحة التحكم ----------
router.get('/dashboard', requirePermission('dashboard.view'), (req, res) => {
  const { from, to } = dateRange(req);
  const args = [from, to];
  let scope = '';
  if (req.user.posIds.length) scope = ` AND i.pos_location_id IN (${req.user.posIds.map(() => '?').join(',')})`;

  const sales = db.prepare(`SELECT COALESCE(SUM(i.total),0) total, COUNT(*) cnt, COALESCE(AVG(i.total),0) avg_invoice,
      COALESCE(SUM(i.discount),0) discounts
    FROM invoices i WHERE i.created_at BETWEEN ? AND ? AND i.status != 'cancelled'${scope}`).get(from, to, ...req.user.posIds);

  const todayRange = dateRange({ query: { period: 'today' } });
  const today = db.prepare(`SELECT COALESCE(SUM(total),0) total, COUNT(*) cnt FROM invoices i WHERE i.created_at BETWEEN ? AND ? AND i.status != 'cancelled'${scope}`)
    .get(todayRange.from, todayRange.to, ...req.user.posIds);
  const monthRange = dateRange({ query: { period: 'month' } });
  const month = db.prepare(`SELECT COALESCE(SUM(total),0) total FROM invoices i WHERE i.created_at BETWEEN ? AND ? AND i.status != 'cancelled'${scope}`)
    .get(monthRange.from, monthRange.to, ...req.user.posIds);

  const returns_ = db.prepare(`SELECT COALESCE(SUM(r.total_refund),0) total, COUNT(*) cnt FROM returns r JOIN invoices i ON i.id=r.invoice_id WHERE r.created_at BETWEEN ? AND ?${scope}`)
    .get(from, to, ...req.user.posIds);

  const byPos = db.prepare(`SELECT pl.name, COALESCE(SUM(i.total),0) total, COUNT(*) cnt FROM invoices i
    JOIN pos_locations pl ON pl.id=i.pos_location_id WHERE i.created_at BETWEEN ? AND ? AND i.status != 'cancelled'${scope}
    GROUP BY i.pos_location_id ORDER BY total DESC`).all(from, to, ...req.user.posIds);

  const byCashier = db.prepare(`SELECT u.full_name AS name, COALESCE(SUM(i.total),0) total, COUNT(*) cnt FROM invoices i
    JOIN users u ON u.id=i.cashier_id WHERE i.created_at BETWEEN ? AND ? AND i.status != 'cancelled'${scope}
    GROUP BY i.cashier_id ORDER BY total DESC LIMIT 10`).all(from, to, ...req.user.posIds);

  const topProducts = db.prepare(`SELECT ii.product_name, SUM(ii.quantity) qty, SUM(ii.total) total FROM invoice_items ii
    JOIN invoices i ON i.id=ii.invoice_id WHERE i.created_at BETWEEN ? AND ? AND i.status != 'cancelled'${scope}
    GROUP BY ii.variant_id ORDER BY qty DESC LIMIT 10`).all(from, to, ...req.user.posIds);

  const lowStock = db.prepare(`SELECT p.name AS product_name, v.sku, v.size, v.color, sl.quantity, v.min_stock,
      CASE sl.location_type WHEN 'warehouse' THEN w.name ELSE pl.name END AS location_name
    FROM stock_levels sl JOIN product_variants v ON v.id=sl.variant_id JOIN products p ON p.id=v.product_id
    LEFT JOIN warehouses w ON sl.location_type='warehouse' AND w.id=sl.location_id
    LEFT JOIN pos_locations pl ON sl.location_type='pos' AND pl.id=sl.location_id
    WHERE sl.quantity <= v.min_stock ORDER BY sl.quantity ASC LIMIT 20`).all();

  const outOfStock = db.prepare(`SELECT COUNT(*) c FROM product_variants v WHERE v.is_active=1 AND NOT EXISTS
    (SELECT 1 FROM stock_levels sl WHERE sl.variant_id=v.id AND sl.quantity>0)`).get().c;

  const inventoryVal = db.prepare(`SELECT COALESCE(SUM(quantity*avg_cost),0) cost_value, COALESCE(SUM(sl.quantity*v.selling_price),0) selling_value
    FROM stock_levels sl JOIN product_variants v ON v.id=sl.variant_id`).get();

  const cashInDrawers = db.prepare(`SELECT COALESCE(SUM(s.opening_cash + s.cash_sales - s.refunds - s.expenses),0) total
    FROM shifts s WHERE s.status='open'`).get();

  const result = {
    period: { from, to }, sales, today, month_total: month.total, returns: returns_,
    by_pos: byPos, by_cashier: byCashier, top_products: topProducts,
    low_stock: lowStock, out_of_stock_variants: outOfStock,
    cash_in_open_drawers: cashInDrawers.total,
  };
  if (req.user.has('cost.view')) {
    result.inventory_cost_value = inventoryVal.cost_value;
    result.inventory_selling_value = inventoryVal.selling_value;
  }
  if (req.user.has('profit.view')) {
    result.gross_profit = db.prepare(`SELECT COALESCE(SUM(ii.total - ii.quantity*ii.cost_price),0) profit FROM invoice_items ii
      JOIN invoices i ON i.id=ii.invoice_id WHERE i.created_at BETWEEN ? AND ? AND i.status NOT IN ('cancelled','returned')${scope}`)
      .get(from, to, ...req.user.posIds).profit;
  }
  res.json(result);
});

// ---------- تقارير المبيعات ----------
router.get('/reports/sales', requirePermission('reports.view'), (req, res) => {
  const { from, to } = dateRange(req);
  const group = req.query.group_by || 'day';
  const args = [from, to];
  let groupExpr, labelExpr;
  switch (group) {
    case 'month': groupExpr = `strftime('%Y-%m', i.created_at)`; labelExpr = groupExpr; break;
    case 'pos': groupExpr = 'i.pos_location_id'; labelExpr = 'pl.name'; break;
    case 'cashier': groupExpr = 'i.cashier_id'; labelExpr = 'u.full_name'; break;
    case 'product': groupExpr = 'ii.variant_id'; labelExpr = 'ii.product_name'; break;
    case 'category': groupExpr = 'p.category_id'; labelExpr = 'c.name'; break;
    case 'supplier': groupExpr = 'p.supplier_id'; labelExpr = 'sup.name'; break;
    case 'season': groupExpr = 'p.season_id'; labelExpr = 'se.name'; break;
    default: groupExpr = `date(i.created_at)`; labelExpr = groupExpr;
  }
  let sql = `SELECT ${labelExpr} AS label, ${groupExpr} AS grp, SUM(ii.total) AS total, SUM(ii.quantity) AS qty, COUNT(DISTINCT i.id) AS invoices
    FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
    JOIN product_variants v ON v.id=ii.variant_id JOIN products p ON p.id=v.product_id
    JOIN pos_locations pl ON pl.id=i.pos_location_id JOIN users u ON u.id=i.cashier_id
    LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN suppliers sup ON sup.id=p.supplier_id
    LEFT JOIN seasons se ON se.id=p.season_id
    WHERE i.created_at BETWEEN ? AND ? AND i.status != 'cancelled'`;
  sql = posScope(req, sql, args);
  if (req.query.pos_location_id) { sql += ' AND i.pos_location_id=?'; args.push(req.query.pos_location_id); }
  if (req.query.cashier_id) { sql += ' AND i.cashier_id=?'; args.push(req.query.cashier_id); }
  if (req.query.category_id) { sql += ' AND (p.category_id=? OR c.parent_id=?)'; args.push(req.query.category_id, req.query.category_id); }
  sql += ` GROUP BY grp ORDER BY total DESC LIMIT 500`;
  res.json(db.prepare(sql).all(...args));
});

// ---------- تقارير المخزون ----------
router.get('/reports/inventory', requirePermission('reports.view'), (req, res) => {
  const type = req.query.type || 'current';
  if (type === 'current' || type === 'valuation' || type === 'low' || type === 'out') {
    let sql = `SELECT sl.location_type, sl.location_id,
        CASE sl.location_type WHEN 'warehouse' THEN w.name ELSE pl.name END AS location_name,
        v.sku, v.barcode, v.size, v.color, v.min_stock, p.name AS product_name, c.name AS category_name,
        sl.quantity, sl.avg_cost, (sl.quantity*sl.avg_cost) AS cost_value, v.selling_price, (sl.quantity*v.selling_price) AS selling_value
      FROM stock_levels sl JOIN product_variants v ON v.id=sl.variant_id JOIN products p ON p.id=v.product_id
      LEFT JOIN categories c ON c.id=p.category_id
      LEFT JOIN warehouses w ON sl.location_type='warehouse' AND w.id=sl.location_id
      LEFT JOIN pos_locations pl ON sl.location_type='pos' AND pl.id=sl.location_id WHERE 1=1`;
    const args = [];
    if (req.query.location_type) { sql += ' AND sl.location_type=?'; args.push(req.query.location_type); }
    if (req.query.location_id) { sql += ' AND sl.location_id=?'; args.push(req.query.location_id); }
    if (req.query.category_id) { sql += ' AND p.category_id=?'; args.push(req.query.category_id); }
    if (type === 'low') sql += ' AND sl.quantity <= v.min_stock AND sl.quantity > 0';
    if (type === 'out') sql += ' AND sl.quantity <= 0';
    sql += ' ORDER BY location_name, product_name LIMIT 2000';
    let rows = db.prepare(sql).all(...args);
    if (!req.user.has('cost.view')) rows = rows.map(({ avg_cost, cost_value, ...r }) => r);
    return res.json(rows);
  }
  if (type === 'slow' || type === 'best') {
    const { from, to } = dateRange(req);
    const order = type === 'slow' ? 'ASC' : 'DESC';
    const rows = db.prepare(`SELECT v.sku, p.name AS product_name, v.size, v.color, COALESCE(SUM(ii.quantity),0) sold_qty,
        (SELECT COALESCE(SUM(sl.quantity),0) FROM stock_levels sl WHERE sl.variant_id=v.id) AS stock
      FROM product_variants v JOIN products p ON p.id=v.product_id
      LEFT JOIN invoice_items ii ON ii.variant_id=v.id
      LEFT JOIN invoices i ON i.id=ii.invoice_id AND i.created_at BETWEEN ? AND ? AND i.status != 'cancelled'
      WHERE v.is_active=1 GROUP BY v.id ORDER BY sold_qty ${order} LIMIT 200`).all(from, to);
    return res.json(rows);
  }
  if (type === 'transfers') {
    const { from, to } = dateRange(req);
    const rows = db.prepare(`SELECT im.*, v.sku, p.name AS product_name, v.size, v.color, u.full_name AS user_name,
        CASE im.source_type WHEN 'warehouse' THEN (SELECT name FROM warehouses WHERE id=im.source_id)
          WHEN 'pos' THEN (SELECT name FROM pos_locations WHERE id=im.source_id) ELSE im.source_type END AS source_name,
        CASE im.dest_type WHEN 'warehouse' THEN (SELECT name FROM warehouses WHERE id=im.dest_id)
          WHEN 'pos' THEN (SELECT name FROM pos_locations WHERE id=im.dest_id) ELSE im.dest_type END AS dest_name
      FROM inventory_movements im JOIN product_variants v ON v.id=im.variant_id JOIN products p ON p.id=v.product_id
      LEFT JOIN users u ON u.id=im.user_id
      WHERE im.movement_type IN ('TRANSFER','TRANSFER_TO_POS','POS_RECEIVE','POS_RETURN') AND im.created_at BETWEEN ? AND ?
      ORDER BY im.id DESC LIMIT 500`).all(from, to);
    if (!req.user.has('cost.view')) rows.forEach(r => delete r.cost_price);
    return res.json(rows);
  }
  badRequest(res, 'نوع تقرير غير معروف');
});

// ---------- تقارير الأرباح ----------
router.get('/reports/profit', requirePermission('profit.view'), (req, res) => {
  const { from, to } = dateRange(req);
  const group = req.query.group_by || 'product';
  let groupExpr, labelExpr;
  switch (group) {
    case 'pos': groupExpr = 'i.pos_location_id'; labelExpr = 'pl.name'; break;
    case 'period': groupExpr = `date(i.created_at)`; labelExpr = groupExpr; break;
    default: groupExpr = 'ii.variant_id'; labelExpr = 'ii.product_name';
  }
  let sql = `SELECT ${labelExpr} AS label, ${groupExpr} AS grp,
      SUM(ii.total) AS revenue, SUM(ii.quantity * ii.cost_price) AS cost,
      SUM(ii.total - ii.quantity * ii.cost_price) AS profit,
      CASE WHEN SUM(ii.total) > 0 THEN ROUND(100.0 * SUM(ii.total - ii.quantity * ii.cost_price) / SUM(ii.total), 2) ELSE 0 END AS margin
    FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
    JOIN pos_locations pl ON pl.id=i.pos_location_id
    WHERE i.created_at BETWEEN ? AND ? AND i.status NOT IN ('cancelled','returned')`;
  const args = [from, to];
  sql = posScope(req, sql, args);
  sql += ' GROUP BY grp ORDER BY profit DESC LIMIT 500';
  res.json(db.prepare(sql).all(...args));
});

// ---------- تقارير الكاشير ----------
router.get('/reports/cashiers', requirePermission('reports.view'), (req, res) => {
  const { from, to } = dateRange(req);
  const rows = db.prepare(`SELECT u.full_name AS cashier, pl.name AS pos_name,
      COUNT(DISTINCT i.id) AS invoices, COALESCE(SUM(i.total),0) sales,
      (SELECT COUNT(*) FROM shifts s WHERE s.cashier_id=u.id AND s.opened_at BETWEEN ? AND ?) AS shifts,
      (SELECT COALESCE(SUM(s.expected_cash),0) FROM shifts s WHERE s.cashier_id=u.id AND s.status='closed' AND s.opened_at BETWEEN ? AND ?) AS expected_cash,
      (SELECT COALESCE(SUM(s.actual_cash),0) FROM shifts s WHERE s.cashier_id=u.id AND s.status='closed' AND s.opened_at BETWEEN ? AND ?) AS actual_cash,
      (SELECT COALESCE(SUM(s.difference),0) FROM shifts s WHERE s.cashier_id=u.id AND s.status='closed' AND s.opened_at BETWEEN ? AND ?) AS difference
    FROM invoices i JOIN users u ON u.id=i.cashier_id JOIN pos_locations pl ON pl.id=i.pos_location_id
    WHERE i.created_at BETWEEN ? AND ? AND i.status != 'cancelled'
    GROUP BY i.cashier_id, i.pos_location_id ORDER BY sales DESC`)
    .all(from, to, from, to, from, to, from, to, from, to);
  res.json(rows);
});

export default router;
