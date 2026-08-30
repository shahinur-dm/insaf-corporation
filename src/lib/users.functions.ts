import { createServerFn } from "@tanstack/react-start";
import type { AppRole } from "./settings-store";
import type { PublicAppUser } from "./users.types";

export type { AppUserDoc, PublicAppUser } from "./users.types";

export const listAppUsersFn = createServerFn({ method: "POST" }).handler(async (): Promise<PublicAppUser[]> => {
  const { requireUser } = await import("./session.server");
  const { listAppUsers } = await import("./users.server");
  const { roleCanAccess } = await import("./settings.server");
  const user = await requireUser();
  const allowed = user.role === "Administrator" || (await roleCanAccess(user.role, "settings"));
  if (!allowed) throw new Error("Not allowed to manage users");
  return listAppUsers();
});

export const listLoginDirectoryFn = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUser } = await import("./session.server");
  const { listLoginDirectory } = await import("./users.server");
  await requireUser();
  return listLoginDirectory();
});

export const upsertAppUserFn = createServerFn({ method: "POST" })
  .inputValidator((d: {
    id?: string;
    username: string;
    displayName: string;
    role: AppRole;
    password?: string;
    active?: boolean;
  }) => d)
  .handler(async ({ data }): Promise<PublicAppUser> => {
    const { requireUser } = await import("./session.server");
    const { upsertAppUser } = await import("./users.server");
    const { roleCanAccess } = await import("./settings.server");
    const user = await requireUser();
    const allowed = user.role === "Administrator" || (await roleCanAccess(user.role, "settings"));
    if (!allowed) throw new Error("Not allowed to manage users");
    try {
      return await upsertAppUser(data);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Could not save user");
    }
  });

export const removeAppUserFn = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireUser } = await import("./session.server");
    const { removeAppUser } = await import("./users.server");
    const { roleCanAccess } = await import("./settings.server");
    const user = await requireUser();
    const allowed = user.role === "Administrator" || (await roleCanAccess(user.role, "settings"));
    if (!allowed) throw new Error("Not allowed to manage users");
    return removeAppUser(data.id);
  });
