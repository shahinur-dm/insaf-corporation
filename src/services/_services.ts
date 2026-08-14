import type {
  Customer, Supplier, Product, Cylinder, CylinderMovement, CylinderStatus,
  SalesOrder, SalesStatus, Delivery, StockAlert, DashboardStats, LineItem,
  Expense, LedgerEntry, PaymentMethod, PurchaseOrder, PurchaseStatus,
  StockMovement, Voucher, VoucherType, Employee, PayrollRun, Account,
  ChartOfAccount, BusinessAsset, CostLayer, CostingMethod, LayerConsumption,
  JournalLine,
} from "@/types";
import { crudFn, dashboardFn, notificationsFn } from "@/lib/data.functions";
import { genOrderNo } from "@/utils/helpers";

const call = async <T,>(op: any, coll: any, id?: string, payload?: any): Promise<T> => {
  return (await crudFn({ data: { op, coll, id, payload } })) as T;
};

type StockMeta = { refType?: StockMovement["refType"]; refId?: string; notes?: string; by?: string };

async function postStockMovement(data: Omit<StockMovement, "id">) {
  return call<StockMovement>("create", "stockMovements", undefined, data);
}

function productMethod(p: Product): CostingMethod {
  return p.costingMethod === "lifo" || p.costingMethod === "average" ? p.costingMethod : "fifo";
}

async function listOpenLayers(productId: string): Promise<CostLayer[]> {
  const all = await call<CostLayer[]>("list", "costLayers");
  return all.filter((l) => l.productId === productId && (l.qtyRemaining || 0) > 0);
}

async function remainingValue(productId: string): Promise<{ qty: number; value: number; avg: number }> {
  const layers = await listOpenLayers(productId);
  const qty = layers.reduce((a, l) => a + l.qtyRemaining, 0);
  const value = layers.reduce((a, l) => a + l.qtyRemaining * (l.unitCost || 0), 0);
  return { qty, value, avg: qty > 0 ? value / qty : 0 };
}

async function ensureOpeningLayer(product: Product) {
  const open = await listOpenLayers(product.id);
  const layerQty = open.reduce((a, l) => a + l.qtyRemaining, 0);
  const stock = product.stock ?? 0;
  if (stock > 0 && layerQty <= 0) {
    await call("create", "costLayers", undefined, {
      productId: product.id,
      qtyRemaining: stock,
      unitCost: product.cost ?? 0,
      receivedAt: product.createdAt || new Date().toISOString(),
      refType: "adjustment",
    });
  }
}

async function consumeLayers(
  productId: string,
  qty: number,
  method: "fifo" | "lifo",
): Promise<LayerConsumption[]> {
  const layers = await listOpenLayers(productId);
  layers.sort((a, b) => {
    const ta = new Date(a.receivedAt).getTime();
    const tb = new Date(b.receivedAt).getTime();
    return method === "fifo" ? ta - tb : tb - ta;
  });
  let need = qty;
  const consumptions: LayerConsumption[] = [];
  for (const layer of layers) {
    if (need <= 0) break;
    const take = Math.min(layer.qtyRemaining, need);
    await call("update", "costLayers", layer.id, { qtyRemaining: layer.qtyRemaining - take });
    consumptions.push({ layerId: layer.id, qty: take, unitCost: layer.unitCost || 0 });
    need -= take;
  }
  if (need > 0) {
    consumptions.push({ layerId: "", qty: need, unitCost: 0 });
  }
  return consumptions;
}

async function receiveStock(productId: string, qty: number, unitCost: number, meta?: StockMeta) {
  const product = await call<Product | null>("get", "products", productId);
  if (!product || qty <= 0) return;
  await ensureOpeningLayer(product);
  const cost = Number.isFinite(unitCost) ? unitCost : (product.cost ?? 0);
  await call("create", "costLayers", undefined, {
    productId: product.id,
    qtyRemaining: qty,
    unitCost: cost,
    receivedAt: new Date().toISOString(),
    refType: meta?.refType,
    refId: meta?.refId,
  });
  const oldStock = product.stock ?? 0;
  const oldCost = product.cost ?? cost;
  const nextStock = oldStock + qty;
  const nextCost = nextStock > 0 ? (oldStock * oldCost + qty * cost) / nextStock : cost;
  await call("update", "products", product.id, { stock: nextStock, cost: nextCost });
  await postStockMovement({
    date: new Date().toISOString(),
    productId: product.id,
    productName: product.name,
    type: "in",
    quantity: qty,
    balanceAfter: nextStock,
    unitCost: cost,
    cogsAmount: qty * cost,
    costingMethod: productMethod(product),
    refType: meta?.refType,
    refId: meta?.refId,
    notes: meta?.notes,
    by: meta?.by ?? "System",
  });
}

async function issueStock(productId: string, qty: number, meta?: StockMeta) {
  const product = await call<Product | null>("get", "products", productId);
  if (!product || qty <= 0) return;
  await ensureOpeningLayer(product);
  const available = product.stock ?? 0;
  const take = Math.min(qty, available);
  if (take <= 0) {
    throw new Error(`Insufficient stock for ${product.name}`);
  }
  const method = productMethod(product);
  let consumptions: LayerConsumption[];
  let unitCost: number;
  let cogsAmount: number;
  if (method === "average") {
    unitCost = product.cost ?? 0;
    cogsAmount = take * unitCost;
    consumptions = await consumeLayers(product.id, take, "fifo");
  } else {
    consumptions = await consumeLayers(product.id, take, method);
    cogsAmount = consumptions.reduce((a, c) => a + c.qty * c.unitCost, 0);
    unitCost = take > 0 ? cogsAmount / take : 0;
  }
  const nextStock = available - take;
  const leftover = await remainingValue(product.id);
  await call("update", "products", product.id, {
    stock: nextStock,
    cost: method === "average" ? (nextStock > 0 ? (product.cost ?? 0) : 0) : leftover.avg,
  });
  await postStockMovement({
    date: new Date().toISOString(),
    productId: product.id,
    productName: product.name,
    type: "out",
    quantity: take,
    balanceAfter: nextStock,
    unitCost,
    cogsAmount,
    costingMethod: method,
    consumptions,
    refType: meta?.refType,
    refId: meta?.refId,
    notes: meta?.notes,
    by: meta?.by ?? "System",
  });
}

async function restoreStock(productId: string, qty: number, meta?: StockMeta, fallbackUnitCost?: number) {
  const product = await call<Product | null>("get", "products", productId);
  if (!product || qty <= 0) return;
  let consumptions: LayerConsumption[] | undefined;
  if (meta?.refId) {
    const moves = await call<StockMovement[]>("list", "stockMovements");
    const out = moves
      .filter((m) => m.productId === productId && m.refType === meta.refType && m.refId === meta.refId && m.type === "out")
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    consumptions = out?.consumptions;
    if (fallbackUnitCost == null && out?.unitCost != null) fallbackUnitCost = out.unitCost;
  }
  if (consumptions?.length) {
    for (const c of consumptions) {
      await call("create", "costLayers", undefined, {
        productId,
        qtyRemaining: c.qty,
        unitCost: c.unitCost,
        receivedAt: new Date().toISOString(),
        refType: meta?.refType,
        refId: meta?.refId,
      });
    }
  } else {
    await call("create", "costLayers", undefined, {
      productId,
      qtyRemaining: qty,
      unitCost: fallbackUnitCost ?? product.cost ?? 0,
      receivedAt: new Date().toISOString(),
      refType: meta?.refType,
      refId: meta?.refId,
    });
  }
  const nextStock = (product.stock ?? 0) + qty;
  const leftover = await remainingValue(productId);
  await call("update", "products", product.id, { stock: nextStock, cost: leftover.avg });
  await postStockMovement({
    date: new Date().toISOString(),
    productId: product.id,
    productName: product.name,
    type: "in",
    quantity: qty,
    balanceAfter: nextStock,
    unitCost: leftover.avg,
    costingMethod: productMethod(product),
    refType: meta?.refType,
    refId: meta?.refId,
    notes: meta?.notes,
    by: meta?.by ?? "System",
  });
}

async function adjustStock(
  items: LineItem[],
  direction: 1 | -1,
  meta?: StockMeta,
) {
  for (const item of items) {
    if (direction < 0) {
      await issueStock(item.productId, item.quantity, meta);
    } else if (meta?.refType === "purchase") {
      await receiveStock(item.productId, item.quantity, item.price, meta);
    } else {
      await restoreStock(item.productId, item.quantity, meta, item.price);
    }
  }
}

function statusFromMovement(type: CylinderMovement["type"]): CylinderStatus {
  switch (type) {
    case "issued": return "at_customer";
    case "returned":
    case "received": return "in_stock";
    case "refilled": return "refilling";
    case "transferred": return "in_transit";
    case "damaged": return "damaged";
    case "lost": return "lost";
    default: return "in_stock";
  }
}

async function postLedger(entry: Omit<LedgerEntry, "id">) {
  return call<LedgerEntry>("create", "ledger", undefined, entry);
}

function toVoucherDate(date?: string) {
  if (!date) return new Date().toISOString();
  if (date.includes("T")) return new Date(date).toISOString();
  const t = new Date(`${date}T12:00:00`);
  return Number.isNaN(t.getTime()) ? new Date().toISOString() : t.toISOString();
}

function journalPairLines(drAccount?: string, crAccount?: string, amount?: number): JournalLine[] {
  const amt = amount ?? 0;
  if (!drAccount || !crAccount || amt <= 0) return [];
  return [
    { accountId: drAccount, accountName: drAccount, debit: amt, credit: 0 },
    { accountId: crAccount, accountName: crAccount, debit: 0, credit: amt },
  ];
}

function assertJournalLines(raw: JournalLine[]) {
  const lines = raw
    .map((l) => ({
      accountId: String(l.accountId || "").trim(),
      accountName: String(l.accountName || l.accountId || "").trim(),
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      notes: l.notes?.trim() || undefined,
    }))
    .filter((l) => l.accountName && (l.debit > 0 || l.credit > 0));
  if (lines.length < 2) throw new Error("Journal needs at least two lines");
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    if (line.debit > 0 && line.credit > 0) throw new Error("A line cannot have both debit and credit");
    debit += line.debit;
    credit += line.credit;
  }
  if (debit <= 0) throw new Error("Amount must be positive");
  if (Math.abs(debit - credit) > 0.009) throw new Error("Debit and credit must be equal");
  return { total: debit, lines };
}

export const customerService = {
  list: () => call<Customer[]>("list", "customers"),
  get: (id: string) => call<Customer | null>("get", "customers", id),
  create: (data: Omit<Customer, "id" | "createdAt">) =>
    call<Customer>("create", "customers", undefined, { ...data, createdAt: new Date().toISOString() }),
  update: (id: string, data: Partial<Customer>) => call<Customer>("update", "customers", id, data),
  remove: (id: string) => call<{ ok: true }>("remove", "customers", id),
};

export const supplierService = {
  list: () => call<Supplier[]>("list", "suppliers"),
  get: (id: string) => call<Supplier | null>("get", "suppliers", id),
  create: (data: Omit<Supplier, "id" | "createdAt">) =>
    call<Supplier>("create", "suppliers", undefined, { ...data, createdAt: new Date().toISOString() }),
  update: (id: string, data: Partial<Supplier>) => call<Supplier>("update", "suppliers", id, data),
  remove: (id: string) => call<{ ok: true }>("remove", "suppliers", id),
};

export const productService = {
  list: () => call<Product[]>("list", "products"),
  get: (id: string) => call<Product | null>("get", "products", id),
  create: async (data: Omit<Product, "id" | "createdAt">) => {
    const created = await call<Product>("create", "products", undefined, {
      ...data,
      costingMethod: data.costingMethod || "fifo",
      createdAt: new Date().toISOString(),
    });
    if ((created.stock ?? 0) > 0) {
      await call("create", "costLayers", undefined, {
        productId: created.id,
        qtyRemaining: created.stock,
        unitCost: created.cost ?? 0,
        receivedAt: created.createdAt,
        refType: "adjustment",
      });
    }
    return created;
  },
  update: (id: string, data: Partial<Product>) => call<Product>("update", "products", id, data),
  remove: (id: string) => call<{ ok: true }>("remove", "products", id),
  stockAlerts: async (): Promise<StockAlert[]> => {
    const list = await call<Product[]>("list", "products");
    return list
      .filter((p) => p.stock <= p.reorderLevel)
      .map((p) => ({ productId: p.id, productName: p.name, stock: p.stock, reorderLevel: p.reorderLevel }));
  },
};

export const cylinderService = {
  list: () => call<Cylinder[]>("list", "cylinders"),
  get: (id: string) => call<Cylinder | null>("get", "cylinders", id),
  create: (data: Omit<Cylinder, "id" | "createdAt" | "lastMovementAt">) => {
    const now = new Date().toISOString();
    return call<Cylinder>("create", "cylinders", undefined, { ...data, createdAt: now, lastMovementAt: now });
  },
  update: (id: string, data: Partial<Cylinder>) => call<Cylinder>("update", "cylinders", id, data),
  remove: (id: string) => call<{ ok: true }>("remove", "cylinders", id),
  listMovements: () => call<CylinderMovement[]>("list", "movements"),
  getMovements: async (cylinderId: string) => {
    const all = await call<CylinderMovement[]>("list", "movements");
    return all.filter((m) => m.cylinderId === cylinderId).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  },
  addMovement: async (data: Omit<CylinderMovement, "id" | "timestamp">) => {
    const now = new Date().toISOString();
    const mv = await call<CylinderMovement>("create", "movements", undefined, { ...data, timestamp: now });
    const status = statusFromMovement(data.type);
    const patch: Record<string, unknown> = { lastMovementAt: mv.timestamp, status };
    if (data.toLocation) patch.location = data.toLocation;
    if (data.type === "issued") patch.customerId = data.customerId;
    else if (data.type === "returned" || data.type === "received") patch.customerId = null;
    else if (data.customerId) patch.customerId = data.customerId;
    await call("update", "cylinders", data.cylinderId, patch);
    return mv;
  },
};

export const salesService = {
  list: () => call<SalesOrder[]>("list", "sales"),
  get: (id: string) => call<SalesOrder | null>("get", "sales", id),
  create: async (data: Omit<SalesOrder, "id">) => {
    const order = await call<SalesOrder>("create", "sales", undefined, data);
    if (data.status === "confirmed" || data.status === "invoiced") {
      await adjustStock(data.items, -1, { refType: "sales", refId: order.id, notes: order.orderNo, by: "Sales" });
    }
    return order;
  },
  update: async (id: string, data: Partial<SalesOrder>) => {
    const existing = await call<SalesOrder | null>("get", "sales", id);
    if (!existing) throw new Error("Order not found");
    const wasStocked = existing.status === "confirmed" || existing.status === "invoiced" || existing.status === "paid";
    if (wasStocked && data.items) {
      await adjustStock(existing.items, 1, {
        refType: "sales", refId: id, notes: `Edit reverse ${existing.orderNo}`, by: "Sales",
      });
      await adjustStock(data.items, -1, {
        refType: "sales", refId: id, notes: `Edit apply ${existing.orderNo}`, by: "Sales",
      });
    }
    return call<SalesOrder>("update", "sales", id, data);
  },
  remove: async (id: string) => {
    const existing = await call<SalesOrder | null>("get", "sales", id);
    if (!existing) throw new Error("Order not found");
    if (existing.status === "confirmed" || existing.status === "invoiced" || existing.status === "paid") {
      await adjustStock(existing.items, 1, {
        refType: "sales", refId: id, notes: `Delete ${existing.orderNo}`, by: "Sales",
      });
    }
    const ledger = await call<LedgerEntry[]>("list", "ledger");
    for (const entry of ledger.filter((e) => e.refType === "sales" && e.refId === id)) {
      await call("remove", "ledger", entry.id);
    }
    const vouchers = await call<Voucher[]>("list", "vouchers");
    for (const v of vouchers.filter((x) => x.refType === "sales" && x.refId === id)) {
      await call("remove", "vouchers", v.id);
    }
    return call<{ ok: true }>("remove", "sales", id);
  },
  setStatus: async (id: string, status: SalesStatus) => {
    const order = await call<SalesOrder | null>("get", "sales", id);
    if (!order) throw new Error("Order not found");
    if (order.status === "cancelled" || order.status === "paid") {
      throw new Error(`Cannot change status from ${order.status}`);
    }
    if (order.status === "draft" && (status === "confirmed" || status === "invoiced")) {
      await adjustStock(order.items, -1, { refType: "sales", refId: id, notes: order.orderNo, by: "Sales" });
    }
    if ((order.status === "confirmed" || order.status === "invoiced") && status === "cancelled") {
      await adjustStock(order.items, 1, { refType: "sales", refId: id, notes: `Cancel ${order.orderNo}`, by: "Sales" });
    }
    return call<SalesOrder>("update", "sales", id, { status });
  },
  convertQuotation: async (id: string) => {
    const order = await call<SalesOrder | null>("get", "sales", id);
    if (!order) throw new Error("Quotation not found");
    if (order.status !== "draft") throw new Error("Only draft quotations can be converted");
    await adjustStock(order.items, -1, { refType: "sales", refId: id, notes: order.orderNo, by: "Sales" });
    return call<SalesOrder>("update", "sales", id, {
      status: "confirmed",
      orderNo: order.orderNo.startsWith("QT") ? order.orderNo.replace(/^QT/, "SO") : order.orderNo,
    });
  },
  recordPayment: async (id: string, amount: number, method: PaymentMethod = "cash") => {
    const order = await call<SalesOrder | null>("get", "sales", id);
    if (!order) throw new Error("order not found");
    if (amount <= 0) throw new Error("Amount must be positive");
    const due = order.total - order.paid;
    if (amount > due) throw new Error("Amount exceeds due balance");
    const paid = order.paid + amount;
    let status: SalesStatus = order.status;
    if (paid >= order.total) status = "paid";
    else if (order.status === "confirmed" || order.status === "draft") status = "invoiced";

    const updated = await call<SalesOrder>("update", "sales", id, { paid, status });
    const payDate = new Date().toISOString();
    const account = method === "cheque" || method === "mobile" ? "bank" : method;
    // Create printable money receipt first so ledger notes can tag voucherNo (safe void)
    const receipt = await call<Voucher>("create", "vouchers", undefined, {
      voucherNo: genOrderNo("MR"),
      type: "receipt",
      date: toVoucherDate(payDate),
      account,
      amount,
      partyType: "customer",
      partyId: order.customerId,
      partyName: order.customerName,
      notes: `Payment for ${order.orderNo}`,
      refType: "sales",
      refId: id,
      refNo: order.orderNo,
      createdAt: payDate,
    });
    await postLedger({
      date: payDate,
      account,
      direction: "in",
      amount,
      category: "collection",
      refType: "sales",
      refId: id,
      notes: `Payment for ${order.orderNo} (${receipt.voucherNo})`,
    });
    return { order: updated, receipt };
  },
  dashboard: async (): Promise<DashboardStats & { stockAlerts: StockAlert[] }> => {
    return await dashboardFn();
  },
};

export const notificationsService = {
  getNotifications: async () => {
    return await notificationsFn();
  }
};

export const deliveryService = {
  list: () => call<Delivery[]>("list", "deliveries"),
  get: (id: string) => call<Delivery | null>("get", "deliveries", id),
  create: (data: Omit<Delivery, "id">) => call<Delivery>("create", "deliveries", undefined, data),
  update: async (id: string, data: Partial<Delivery>) => {
    const existing = await call<Delivery | null>("get", "deliveries", id);
    if (!existing) throw new Error("Delivery not found");
    if (existing.status !== "pending") throw new Error("Only pending deliveries can be edited");
    return call<Delivery>("update", "deliveries", id, data);
  },
  remove: async (id: string) => {
    const existing = await call<Delivery | null>("get", "deliveries", id);
    if (!existing) throw new Error("Delivery not found");
    if (existing.status !== "pending") throw new Error("Only pending deliveries can be deleted");
    return call<{ ok: true }>("remove", "deliveries", id);
  },
  confirm: async (id: string, payload?: { issuedIdsByItem?: string[][]; returnedIds?: string[] }) => {
    const delivery = await call<Delivery | null>("get", "deliveries", id);
    if (!delivery) throw new Error("Delivery not found");
    if (delivery.status !== "pending" && delivery.status !== "in_transit") {
      throw new Error("Already confirmed");
    }

    const products = await call<Product[]>("list", "products");
    const allCyl = await call<Cylinder[]>("list", "cylinders");
    const nextItems = delivery.items.map((item, i) => {
      const assigned = payload?.issuedIdsByItem?.[i];
      return assigned ? { ...item, cylinderIds: assigned } : item;
    });

    const used = new Set<string>();
    for (const item of nextItems) {
      const p = products.find((x) => x.id === item.productId);
      if (p?.uom !== "cyl") continue;
      const ids = item.cylinderIds || [];
      if (ids.length !== item.quantity) {
        throw new Error(`Select ${item.quantity} cylinder(s) for ${item.productName}`);
      }
      for (const cid of ids) {
        if (used.has(cid)) throw new Error("Duplicate cylinder selected");
        used.add(cid);
        const cyl = allCyl.find((c) => c.id === cid);
        if (!cyl) throw new Error("Cylinder not found");
        if (cyl.productId !== item.productId) {
          throw new Error(`${cyl.serialNumber} does not match ${item.productName}`);
        }
        if (cyl.status !== "in_stock" && cyl.status !== "in_transit") {
          throw new Error(`${cyl.serialNumber} is ${cyl.status}, not available to issue`);
        }
      }
    }

    if (!delivery.salesOrderId) {
      await adjustStock(nextItems, -1, {
        refType: "delivery", refId: id, notes: delivery.challanNo, by: "Delivery",
      });
    } else {
      const so = await call<SalesOrder | null>("get", "sales", delivery.salesOrderId);
      if (so && so.status === "confirmed") {
        await call("update", "sales", so.id, { status: "invoiced" });
      }
    }

    for (const item of nextItems) {
      for (const cid of item.cylinderIds || []) {
        await cylinderService.addMovement({
          cylinderId: cid,
          type: "issued",
          customerId: delivery.customerId,
          fromLocation: "Warehouse",
          toLocation: delivery.customerName,
          notes: `Auto-issued from Delivery ${delivery.challanNo}`,
          by: "Delivery",
        });
      }
    }

    for (const cid of payload?.returnedIds || []) {
      const cyl = allCyl.find((c) => c.id === cid);
      if (!cyl) throw new Error("Return cylinder not found");
      if (cyl.customerId && cyl.customerId !== delivery.customerId) {
        throw new Error(`${cyl.serialNumber} belongs to another customer`);
      }
      await cylinderService.addMovement({
        cylinderId: cid,
        type: "returned",
        customerId: delivery.customerId,
        fromLocation: delivery.customerName,
        toLocation: "Warehouse",
        notes: `Empty returned with Delivery ${delivery.challanNo}`,
        by: "Delivery",
      });
    }

    return call<Delivery>("update", "deliveries", id, {
      status: "delivered",
      confirmedAt: new Date().toISOString(),
      items: nextItems,
    });
  },
};

export const expenseService = {
  list: () => call<Expense[]>("list", "expenses"),
  get: (id: string) => call<Expense | null>("get", "expenses", id),
  create: async (data: Omit<Expense, "id" | "createdAt">) => {
    const now = new Date().toISOString();
    const expense = await call<Expense>("create", "expenses", undefined, { ...data, createdAt: now });
    const account = data.paymentMethod === "cheque" || data.paymentMethod === "mobile" ? "bank" : data.paymentMethod;
    await postLedger({
      date: data.date || now,
      account,
      direction: "out",
      amount: data.amount,
      category: "expense",
      refType: "expense",
      refId: expense.id,
      notes: data.description,
    });
    return expense;
  },
  remove: async (id: string) => {
    const expense = await call<Expense | null>("get", "expenses", id);
    if (expense) {
      const ledger = await call<LedgerEntry[]>("list", "ledger");
      const linked = ledger.filter((e) => e.refType === "expense" && e.refId === id);
      for (const entry of linked) {
        await call("remove", "ledger", entry.id);
      }
    }
    return call<{ ok: true }>("remove", "expenses", id);
  },
  update: async (id: string, data: Partial<Expense>) => {
    const existing = await call<Expense | null>("get", "expenses", id);
    if (!existing) throw new Error("Expense not found");
    const ledger = await call<LedgerEntry[]>("list", "ledger");
    const linked = ledger.filter((e) => e.refType === "expense" && e.refId === id);
    for (const entry of linked) {
      await call("remove", "ledger", entry.id);
    }
    const updated = await call<Expense>("update", "expenses", id, data);
    const paymentMethod = updated.paymentMethod ?? existing.paymentMethod;
    const account = paymentMethod === "cheque" || paymentMethod === "mobile" ? "bank" : paymentMethod;
    await postLedger({
      date: updated.date || existing.date,
      account,
      direction: "out",
      amount: updated.amount,
      category: "expense",
      refType: "expense",
      refId: id,
      notes: updated.description,
    });
    return updated;
  },
};

export const purchaseService = {
  list: () => call<PurchaseOrder[]>("list", "purchases"),
  get: (id: string) => call<PurchaseOrder | null>("get", "purchases", id),
  create: async (data: Omit<PurchaseOrder, "id">) => {
    return call<PurchaseOrder>("create", "purchases", undefined, data);
  },
  update: async (id: string, data: Partial<PurchaseOrder>) => {
    const existing = await call<PurchaseOrder | null>("get", "purchases", id);
    if (!existing) throw new Error("Purchase order not found");
    if (existing.status !== "draft" && existing.status !== "ordered") {
      throw new Error("Only draft or ordered POs can be edited");
    }
    if (existing.paid > 0) throw new Error("Cannot edit a PO with payments");
    return call<PurchaseOrder>("update", "purchases", id, data);
  },
  remove: async (id: string) => {
    const existing = await call<PurchaseOrder | null>("get", "purchases", id);
    if (!existing) throw new Error("Purchase order not found");
    if (existing.status !== "draft" && existing.status !== "cancelled") {
      throw new Error("Only draft or cancelled POs can be deleted");
    }
    const ledger = await call<LedgerEntry[]>("list", "ledger");
    for (const entry of ledger.filter((e) => e.refType === "purchase" && e.refId === id)) {
      await call("remove", "ledger", entry.id);
    }
    return call<{ ok: true }>("remove", "purchases", id);
  },
  setStatus: async (id: string, status: PurchaseStatus) => {
    const po = await call<PurchaseOrder | null>("get", "purchases", id);
    if (!po) throw new Error("Purchase order not found");
    if (po.status === "cancelled" || po.status === "paid") {
      throw new Error(`Cannot change status from ${po.status}`);
    }
    if (status === "cancelled" && (po.status === "received" || po.status === "billed")) {
      throw new Error("Cannot cancel after goods received");
    }
    return call<PurchaseOrder>("update", "purchases", id, { status });
  },
  receive: async (id: string, payload?: { serialsByItem?: string[][] }) => {
    const po = await call<PurchaseOrder | null>("get", "purchases", id);
    if (!po) throw new Error("Purchase order not found");
    if (po.status !== "ordered" && po.status !== "draft") {
      throw new Error("Only ordered/draft POs can be received");
    }
    const products = await call<Product[]>("list", "products");
    let cylinders = await call<Cylinder[]>("list", "cylinders");
    const nextItems = [...po.items];

    for (let i = 0; i < nextItems.length; i++) {
      const item = nextItems[i];
      const p = products.find((x) => x.id === item.productId);
      if (p?.uom !== "cyl") continue;
      const serials = (payload?.serialsByItem?.[i] || []).map((s) => s.trim()).filter(Boolean);
      if (serials.length === 0 && item.cylinderIds?.length === item.quantity) continue;
      if (serials.length !== item.quantity) {
        throw new Error(`Enter ${item.quantity} serial number(s) for ${item.productName}`);
      }
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const serial of serials) {
        const key = serial.toLowerCase();
        if (seen.has(key)) throw new Error(`Duplicate serial ${serial}`);
        seen.add(key);
        let found = cylinders.find((c) => c.serialNumber.toLowerCase() === key);
        if (!found) {
          found = await cylinderService.create({
            serialNumber: serial,
            productId: item.productId,
            capacity: 0,
            status: "in_transit",
            location: po.supplierName,
          });
          cylinders = [...cylinders, found];
        } else {
          if (found.productId !== item.productId) {
            throw new Error(`Cylinder ${serial} does not match ${item.productName}`);
          }
          if (found.status === "in_stock") {
            throw new Error(`${serial} is already in warehouse`);
          }
        }
        ids.push(found.id);
      }
      nextItems[i] = { ...item, cylinderIds: ids };
    }

    const grnNo = genOrderNo("GRN");
    await adjustStock(nextItems, 1, { refType: "purchase", refId: id, notes: grnNo, by: "Warehouse" });

    for (const item of nextItems) {
      for (const cid of item.cylinderIds || []) {
        await cylinderService.addMovement({
          cylinderId: cid,
          type: "received",
          supplierId: po.supplierId,
          fromLocation: po.supplierName,
          toLocation: "Warehouse",
          notes: `Auto-received from PO ${po.orderNo} (GRN ${grnNo})`,
          by: "Purchase",
        });
      }
    }
    return call<PurchaseOrder>("update", "purchases", id, {
      status: "received",
      grnNo,
      receivedAt: new Date().toISOString(),
      items: nextItems,
    });
  },
  recordPayment: async (id: string, amount: number, method: PaymentMethod = "bank") => {
    const po = await call<PurchaseOrder | null>("get", "purchases", id);
    if (!po) throw new Error("Purchase order not found");
    if (amount <= 0) throw new Error("Amount must be positive");
    const due = po.total - po.paid;
    if (amount > due) throw new Error("Amount exceeds due balance");
    const paid = po.paid + amount;
    let status: PurchaseStatus = po.status === "ordered" || po.status === "draft" ? "billed" : po.status;
    if (po.status === "received") status = "billed";
    if (paid >= po.total) status = "paid";
    const updated = await call<PurchaseOrder>("update", "purchases", id, { paid, status });
    const account = method === "cheque" || method === "mobile" ? "bank" : method;
    await postLedger({
      date: new Date().toISOString(),
      account,
      direction: "out",
      amount,
      category: "purchase",
      refType: "purchase",
      refId: id,
      notes: `Payment for ${po.orderNo}`,
    });
    return updated;
  },
};

export const inventoryService = {
  listMovements: () => call<StockMovement[]>("list", "stockMovements"),
  adjust: async (productId: string, quantity: number, type: "in" | "out" | "adjust", notes?: string) => {
    const product = await call<Product | null>("get", "products", productId);
    if (!product) throw new Error("Product not found");
    if (quantity <= 0) throw new Error("Quantity must be positive");
    const meta: StockMeta = { refType: "adjustment", notes: notes || "Manual stock adjustment", by: "Warehouse" };
    if (type === "in") {
      await receiveStock(productId, quantity, product.cost ?? 0, meta);
      return;
    }
    if (type === "out") {
      await issueStock(productId, quantity, meta);
      return;
    }
    const current = product.stock ?? 0;
    if (quantity > current) await receiveStock(productId, quantity - current, product.cost ?? 0, meta);
    else if (quantity < current) await issueStock(productId, current - quantity, meta);
  },
};

export const accountingService = {
  listAccounts: () => call<Account[]>("list", "accounts"),
  createAccount: (data: Omit<Account, "id" | "createdAt">) =>
    call<Account>("create", "accounts", undefined, { ...data, createdAt: new Date().toISOString() }),
  updateAccount: (id: string, data: Partial<Account>) => call<Account>("update", "accounts", id, data),
  removeAccount: (id: string) => call<{ ok: true }>("remove", "accounts", id),
  listLedger: () => call<LedgerEntry[]>("list", "ledger"),
  listVouchers: () => call<Voucher[]>("list", "vouchers"),
  createVoucher: async (data: {
    type: VoucherType;
    account: PaymentMethod;
    amount: number;
    date?: string;
    partyType?: "customer" | "supplier" | "employee";
    partyId?: string;
    partyName?: string;
    drAccount?: string;
    crAccount?: string;
    lines?: JournalLine[];
    notes?: string;
    refType?: "sales" | "purchase" | "expense" | "payroll";
    refId?: string;
    refNo?: string;
  }) => {
    if (data.type === "journal") {
      const lines = data.lines?.length
        ? data.lines
        : journalPairLines(data.drAccount, data.crAccount, data.amount);
      return accountingService.postJournal({ date: data.date, notes: data.notes, lines });
    }
    if (data.amount <= 0) throw new Error("Amount must be positive");
    const prefix = data.type === "receipt" ? "RV" : "PV";
    const voucher = await call<Voucher>("create", "vouchers", undefined, {
      voucherNo: genOrderNo(prefix),
      type: data.type,
      date: toVoucherDate(data.date),
      account: data.account,
      amount: data.amount,
      partyType: data.partyType,
      partyId: data.partyId,
      partyName: data.partyName,
      notes: data.notes,
      refType: data.refType,
      refId: data.refId,
      refNo: data.refNo,
      createdAt: new Date().toISOString(),
    });
    await postLedger({
      date: voucher.date,
      account: data.account,
      direction: data.type === "receipt" ? "in" : "out",
      amount: data.amount,
      category: data.type === "receipt" ? "receipt" : "payment",
      refType: "voucher",
      refId: voucher.id,
      notes: data.notes || voucher.voucherNo,
    });
    return voucher;
  },
  postJournal: async (data: { date?: string; notes?: string; lines: JournalLine[] }) => {
    const { total, lines } = assertJournalLines(data.lines);
    const firstDr = lines.find((l) => l.debit > 0);
    const firstCr = lines.find((l) => l.credit > 0);
    const voucher = await call<Voucher>("create", "vouchers", undefined, {
      voucherNo: genOrderNo("JV"),
      type: "journal",
      date: toVoucherDate(data.date),
      account: firstDr?.accountName || "journal",
      amount: total,
      drAccount: firstDr?.accountName,
      crAccount: firstCr?.accountName,
      lines,
      notes: data.notes,
      createdAt: new Date().toISOString(),
    });
    for (const line of lines) {
      const note = line.notes || data.notes || voucher.voucherNo;
      if (line.debit > 0) {
        await postLedger({
          date: voucher.date,
          account: line.accountName as PaymentMethod,
          direction: "in",
          amount: line.debit,
          category: "journal",
          refType: "voucher",
          refId: voucher.id,
          notes: note,
        });
      }
      if (line.credit > 0) {
        await postLedger({
          date: voucher.date,
          account: line.accountName as PaymentMethod,
          direction: "out",
          amount: line.credit,
          category: "journal",
          refType: "voucher",
          refId: voucher.id,
          notes: note,
        });
      }
    }
    return voucher;
  },
  removeVoucher: async (id: string) => {
    const voucher = await call<Voucher | null>("get", "vouchers", id);
    if (!voucher) throw new Error("Voucher not found");

    // Money receipts created from invoice payment: reverse sales paid + matching ledger
    if (voucher.type === "receipt" && voucher.refType === "sales" && voucher.refId) {
      const order = await call<SalesOrder | null>("get", "sales", voucher.refId);
      if (order) {
        const paid = Math.max(0, (order.paid || 0) - voucher.amount);
        let status: SalesStatus = order.status;
        if (order.status === "paid" && paid < order.total) {
          status = paid > 0 ? "invoiced" : "confirmed";
        }
        await call("update", "sales", order.id, { paid, status });
      }
      const ledger = await call<LedgerEntry[]>("list", "ledger");
      const byVoucherNo = ledger.filter(
        (e) =>
          e.refType === "sales"
          && e.refId === voucher.refId
          && e.direction === "in"
          && e.amount === voucher.amount
          && (e.notes || "").includes(voucher.voucherNo),
      );
      const byOrderNo = ledger
        .filter(
          (e) =>
            e.refType === "sales"
            && e.refId === voucher.refId
            && e.direction === "in"
            && e.amount === voucher.amount
            && (e.notes || "").includes(voucher.refNo || ""),
        )
        .sort((a, b) => b.date.localeCompare(a.date));
      const toRemove = byVoucherNo.length
        ? byVoucherNo.slice(0, 1)
        : byOrderNo.length
          ? byOrderNo.slice(0, 1)
          : ledger.filter((e) => e.refType === "voucher" && e.refId === id);
      for (const entry of toRemove) {
        await call("remove", "ledger", entry.id);
      }
      return call<{ ok: true }>("remove", "vouchers", id);
    }

    const ledger = await call<LedgerEntry[]>("list", "ledger");
    for (const entry of ledger.filter((e) => e.refType === "voucher" && e.refId === id)) {
      await call("remove", "ledger", entry.id);
    }
    return call<{ ok: true }>("remove", "vouchers", id);
  },
  listCoa: () => call<ChartOfAccount[]>("list", "chartOfAccounts"),
  createCoa: (data: Omit<ChartOfAccount, "id" | "createdAt">) =>
    call<ChartOfAccount>("create", "chartOfAccounts", undefined, { ...data, createdAt: new Date().toISOString() }),
  updateCoa: (id: string, data: Partial<ChartOfAccount>) => call<ChartOfAccount>("update", "chartOfAccounts", id, data),
  removeCoa: (id: string) => call<{ ok: true }>("remove", "chartOfAccounts", id),
  
  listAssets: () => call<BusinessAsset[]>("list", "assets"),
  createAsset: (data: Omit<BusinessAsset, "id" | "createdAt">) =>
    call<BusinessAsset>("create", "assets", undefined, { ...data, createdAt: new Date().toISOString() }),
  updateAsset: (id: string, data: Partial<BusinessAsset>) => call<BusinessAsset>("update", "assets", id, data),
  removeAsset: (id: string) => call<{ ok: true }>("remove", "assets", id),
};

export const hrService = {
  listEmployees: () => call<Employee[]>("list", "employees"),
  getEmployee: (id: string) => call<Employee | null>("get", "employees", id),
  createEmployee: (data: Omit<Employee, "id" | "createdAt" | "employeeNo">) =>
    call<Employee>("create", "employees", undefined, {
      ...data,
      employeeNo: genOrderNo("EMP"),
      createdAt: new Date().toISOString(),
    }),
  updateEmployee: (id: string, data: Partial<Employee>) => call<Employee>("update", "employees", id, data),
  removeEmployee: (id: string) => call<{ ok: true }>("remove", "employees", id),
  listPayroll: () => call<PayrollRun[]>("list", "payroll"),
  createPayroll: async (data: Omit<PayrollRun, "id" | "createdAt" | "net" | "status">) => {
    const net = data.basic + data.bonus + data.allowance - data.deduction;
    return call<PayrollRun>("create", "payroll", undefined, {
      ...data,
      net,
      status: "draft",
      createdAt: new Date().toISOString(),
    });
  },
  updatePayroll: async (id: string, data: Partial<Pick<PayrollRun, "bonus" | "allowance" | "deduction" | "basic" | "month">>) => {
    const run = await call<PayrollRun | null>("get", "payroll", id);
    if (!run) throw new Error("Payroll not found");
    if (run.status !== "draft") throw new Error("Only draft payslips can be edited");
    const basic = data.basic ?? run.basic;
    const bonus = data.bonus ?? run.bonus;
    const allowance = data.allowance ?? run.allowance;
    const deduction = data.deduction ?? run.deduction;
    return call<PayrollRun>("update", "payroll", id, {
      ...data,
      net: basic + bonus + allowance - deduction,
    });
  },
  removePayroll: async (id: string) => {
    const run = await call<PayrollRun | null>("get", "payroll", id);
    if (!run) throw new Error("Payroll not found");
    if (run.status !== "draft") throw new Error("Only draft payslips can be deleted");
    return call<{ ok: true }>("remove", "payroll", id);
  },
  payPayroll: async (id: string, method: PaymentMethod = "bank") => {
    const run = await call<PayrollRun | null>("get", "payroll", id);
    if (!run) throw new Error("Payroll not found");
    if (run.status === "paid") throw new Error("Already paid");
    const account = method === "cheque" || method === "mobile" ? "bank" : method;
    await postLedger({
      date: new Date().toISOString(),
      account,
      direction: "out",
      amount: run.net,
      category: "expense",
      refType: "payroll",
      refId: id,
      notes: `Salary ${run.employeeName} · ${run.month}`,
    });
    return call<PayrollRun>("update", "payroll", id, {
      status: "paid",
      paidAt: new Date().toISOString(),
      paymentMethod: method,
    });
  },
};
