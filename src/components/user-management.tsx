"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { roleLabels } from "@/lib/rbac";
import { formatDate } from "@/lib/utils";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
}

const roles: UserRole[] = ["ADMIN", "VENTAS", "BODEGA", "COMPRAS"];

export function UserManagement({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string;
}) {
  const router = useRouter();

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-brand-900">Usuarios</h1>
        <p className="text-sm text-slate-500">
          Cuentas de tu equipo y el rol de cada una. Solo los administradores ven esta sección.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cuentas activas</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <Thead>
              <Tr>
                <Th>Nombre</Th>
                <Th>Correo</Th>
                <Th>Rol</Th>
                <Th>Estado</Th>
                <Th>Desde</Th>
                <Th></Th>
              </Tr>
            </Thead>
            <Tbody>
              {users.map((user) => (
                <UserRowItem
                  key={user.id}
                  user={user}
                  isSelf={user.id === currentUserId}
                  onSaved={() => router.refresh()}
                />
              ))}
            </Tbody>
          </Table>
        </CardContent>
      </Card>

      <div className="mt-6">
        <AddUserForm onSaved={() => router.refresh()} />
      </div>
    </div>
  );
}

function UserRowItem({
  user,
  isSelf,
  onSaved,
}: {
  user: UserRow;
  isSelf: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<UserRole>(user.role);
  const [active, setActive] = useState(user.active);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role, active, password: password || undefined }),
    });
    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo guardar.");
      return;
    }

    setPassword("");
    setEditing(false);
    onSaved();
  }

  if (editing) {
    return (
      <Tr>
        <Td colSpan={6}>
          <div className="grid grid-cols-5 gap-2 py-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" />
            <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {roleLabels[r]}
                </option>
              ))}
            </Select>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nueva contraseña (opcional)"
            />
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                disabled={isSelf}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-xs text-slate-500">Activo</span>
            </div>
          </div>
          {isSelf && (
            <p className="mt-1 text-xs text-slate-400">
              No puedes desactivarte ni quitarte el rol de administrador a ti mismo.
            </p>
          )}
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSave} disabled={loading}>
              {loading ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </Td>
      </Tr>
    );
  }

  return (
    <Tr>
      <Td className="font-medium text-slate-800">
        {user.name} {isSelf && <span className="text-xs text-slate-400">(tú)</span>}
      </Td>
      <Td className="text-slate-500">{user.email}</Td>
      <Td>{roleLabels[user.role]}</Td>
      <Td>
        <Badge tone={user.active ? "good" : "neutral"}>
          {user.active ? "Activo" : "Inactivo"}
        </Badge>
      </Td>
      <Td className="text-xs text-slate-400">{formatDate(user.createdAt)}</Td>
      <Td>
        <button
          onClick={() => setEditing(true)}
          className="text-xs font-medium text-brand-700 hover:underline"
        >
          Editar
        </button>
      </Td>
    </Tr>
  );
}

function AddUserForm({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("BODEGA");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "No se pudo crear el usuario.");
      return;
    }

    setName("");
    setEmail("");
    setPassword("");
    setRole("BODEGA");
    setOpen(false);
    onSaved();
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        + Agregar usuario
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nuevo usuario</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="u-name">Nombre</Label>
              <Input id="u-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="u-email">Correo</Label>
              <Input
                id="u-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="u-password">Contraseña temporal</Label>
              <Input
                id="u-password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
              />
            </div>
            <div>
              <Label htmlFor="u-role">Rol</Label>
              <Select id="u-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {roleLabels[r]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creando…" : "Crear usuario"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
