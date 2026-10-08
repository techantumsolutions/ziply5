"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { authedFetch } from "@/lib/dashboard-fetch";

import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable";
import { Button } from "@/components/ui/button";
import { ToggleLeft, ToggleRight } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type UserRow = {
  id: string;
  email: string;
  name: string;
  status: string;
  createdAt: string;
  roles: Array<{ role: { key: string; name: string } }>;
};

export default function AdminUsersPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Modal State
  const [open, setOpen] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Submit State
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");

    authedFetch<{ items: UserRow[]; total: number }>(
      "/api/v1/users?page=1&limit=100"
    )
      .then((d) => {
        setRows(d.items);
        setTotal(d.total);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Submit Handler
  const handleCreateUser = async () => {
    try {
      setSubmitting(true);
      setSuccessMsg("");
      setError("");

      await authedFetch("/api/v1/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          name,
          email,
          password,
          role: "customer",
          isFromAdmin: true,
        }),
      });

      setSuccessMsg("User created successfully 🎉");

      // Reset form
      setName("");
      setEmail("");
      setPassword("");

      // Reload users list
      load();

      // Close modal after short delay
      setTimeout(() => {
        setOpen(false);
        setSuccessMsg("");
      }, 1500);
    } catch (e: any) {
      setError(e.message || "Failed to create user");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (
  userId: string,
  currentStatus: string
) => {
  
  try {
    const newStatus =
      currentStatus === "active"
        ? "suspended"
        : "active";

    await authedFetch(
      `/api/v1/users/${userId}/status`,
      {
        method: "PUT",
        body: JSON.stringify({
          status: newStatus,
        }),
      }
    );

    // Reload users
    load();

  } catch (error: any) {
    setError(
      error.message ||
      "Failed to update status"
    );
  }
};

  const filteredRows = useMemo(() => {
    return rows.filter((u) => {
      const matchesSearch =
        (u.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (u.email || "").toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === "all" || u.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [rows, searchTerm, statusFilter]);

  return (
    <section className="w-full space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">
            Users
          </h1>
          <p className="text-sm text-[#646464]">
            Accounts - {total} 
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => load()}
            className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]"
          >
            Refresh
          </button>

          <Button
            onClick={() => setOpen(true)}
            className="bg-[#4A1D1F] rounded-full cursor-pointer text-xs h-[30px] text-white hover:bg-[#4A1D1F]/90"
          >
            Add User
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <input type="text" placeholder="Search by name or email..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full rounded-full border border-[#E3E3DA] bg-[#FAFBF9] px-4 py-2.5 text-sm placeholder-[#8A8A8A] focus:border-[#7B3010] focus:outline-none" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-auto w-full rounded-full border border-[#E3E3DA] bg-white px-4 py-2.5 text-sm text-[#4A1D1F] shadow-none focus:border-[#7B3010] focus:outline-none focus:ring-0 focus-visible:ring-0">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {loading && (
        <p className="text-sm text-[#646464]">Loading…</p>
      )}

      {!loading && (
        <ConsoleTable
          headers={["Name", "Email", "Roles", "Status", "Joined","Edit"]}
        >
          {filteredRows.length === 0 ? (
            <tr>
              <ConsoleTd
                colSpan={6}
                className="py-8 text-center text-[#646464]"
              >
                No users found.
              </ConsoleTd>
            </tr>
          ) : (
            filteredRows.map((u) => (
              <tr
                key={u.id}
                className="hover:bg-[#FFFBF3]/80"
              >
                <ConsoleTd className="font-medium">
                  {u.name}
                </ConsoleTd>

                <ConsoleTd>{u.email}</ConsoleTd>

                <ConsoleTd className="text-[12px] capitalize">
                  {u.roles
                    .map((r) =>
                      r.role.key.replaceAll("_", " ")
                    )
                    .join(", ") || "—"}
                </ConsoleTd>

               <ConsoleTd className="capitalize">
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded-full ${
                      u.status === "active"
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {u.status}
                  </span>
                </ConsoleTd>

                <ConsoleTd className="text-[12px] text-[#646464]">
                  {new Date(
                    u.createdAt
                  ).toLocaleDateString()}
                </ConsoleTd>

                {/*Edit column */}

                <ConsoleTd>

                  <button
                    onClick={() =>
                      handleToggleStatus(
                        u.id,
                        u.status
                      )
                    }
                    className="cursor-pointer hover:scale-110 transition"
                    title="Toggle Status"
                  >

                    {u.status === "active" ? (

                      <ToggleRight
                        size={24}
                        className="text-green-600"
                      />

                    ) : (

                      <ToggleLeft
                        size={24}
                        className="text-gray-400"
                      />

                    )}

                  </button>

                </ConsoleTd>
                 
              </tr>
            ))
          )}
        </ConsoleTable>
      )}

      {/* Add User Modal */}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">

            {/* Name */}

            <div className="space-y-1">
              <Label>Name</Label>

              <Input
                placeholder="Enter full name"
                value={name}
                onChange={(e) =>
                  setName(e.target.value)
                }
              />
            </div>

            {/* Email */}

            <div className="space-y-1">
              <Label>Email</Label>

              <Input
                type="email"
                placeholder="Enter email address"
                value={email}
                onChange={(e) =>
                  setEmail(e.target.value)
                }
              />
            </div>

            {/* Password */}

            <div className="space-y-1">
              <Label>Password</Label>

              <Input
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
              />
            </div>

            {/* Success Message */}

            {successMsg && (
              <p className="text-sm text-green-600">
                {successMsg}
              </p>
            )}

          </div>

          <DialogFooter className="mt-4">

            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>

            <Button
              onClick={handleCreateUser}
              disabled={submitting}
              className="bg-[#4A1D1F] text-white hover:bg-[#4A1D1F]/90"
            >
              {submitting
                ? "Creating..."
                : "Create User"}
            </Button>

          </DialogFooter>
        </DialogContent>
      </Dialog>

    </section>
  );
}