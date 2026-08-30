import type { AppModule } from "./settings-store";

export type CrudCollName =
  | "customers" | "suppliers" | "products" | "cylinders" | "movements"
  | "sales" | "deliveries" | "expenses" | "ledger"
  | "purchases" | "stockMovements" | "vouchers" | "employees" | "payroll"
  | "appUsers" | "accounts" | "chartOfAccounts" | "assets" | "costLayers";

export type CrudOp = "list" | "get" | "create" | "update" | "remove" | "claim";

const WRITE: Record<CrudCollName, AppModule[]> = {
  customers: ["customers"],
  suppliers: ["suppliers"],
  products: ["products", "inventory", "sales", "deliveries", "purchases"],
  cylinders: ["cylinders", "inventory", "deliveries"],
  movements: ["cylinders", "inventory", "deliveries"],
  sales: ["sales", "deliveries", "inventory"],
  deliveries: ["deliveries"],
  expenses: ["expenses"],
  ledger: ["accounting", "expenses", "sales", "purchases", "inventory"],
  purchases: ["purchases"],
  stockMovements: ["inventory", "purchases", "sales", "deliveries"],
  vouchers: ["accounting", "inventory"],
  employees: ["hr"],
  payroll: ["hr"],
  appUsers: ["settings"],
  accounts: ["accounting"],
  chartOfAccounts: ["accounting"],
  assets: ["accounting"],
  costLayers: ["inventory", "purchases", "sales"],
};

const READ: Record<CrudCollName, AppModule[]> = {
  customers: ["customers", "sales", "deliveries", "accounting", "reports"],
  suppliers: ["suppliers", "purchases", "accounting", "reports", "inventory"],
  products: ["products", "sales", "purchases", "inventory", "cylinders", "deliveries", "reports"],
  cylinders: ["cylinders", "inventory", "deliveries", "sales", "purchases", "reports", "customers", "suppliers"],
  movements: ["cylinders", "inventory", "deliveries", "sales", "purchases", "reports", "customers", "suppliers"],
  sales: ["sales", "accounting", "reports", "deliveries", "dashboard"],
  deliveries: ["deliveries", "sales", "reports"],
  expenses: ["expenses", "accounting", "reports", "dashboard"],
  ledger: ["accounting", "reports"],
  purchases: ["purchases", "accounting", "reports", "inventory"],
  stockMovements: ["inventory", "purchases", "sales", "deliveries", "reports"],
  vouchers: ["accounting", "reports"],
  employees: ["hr", "reports"],
  payroll: ["hr", "reports"],
  appUsers: ["settings"],
  accounts: ["accounting", "reports"],
  chartOfAccounts: ["accounting", "reports"],
  assets: ["accounting", "reports"],
  costLayers: ["inventory", "purchases", "sales", "reports"],
};

const WRITE_OPS = new Set<CrudOp>(["create", "update", "remove", "claim"]);

export function isKnownCrudCollection(coll: string): coll is CrudCollName {
  return Object.prototype.hasOwnProperty.call(WRITE, coll);
}

export function modulesForCrud(coll: CrudCollName, op: CrudOp): AppModule[] {
  return WRITE_OPS.has(op) ? WRITE[coll] : READ[coll];
}
