"use client";

import { useState, useEffect } from "react";
import { useMasterValues, useMasterGroups } from "@/hooks/useMasterData";
import { authedFetch } from "@/lib/dashboard-fetch";
import { Edit2, Check, X, Trash2 } from "lucide-react";

type Props = {
  groupKey: string;
  groupName: string;
};

export default function MasterDataCreatorForm({ groupKey, groupName }: Props) {
  const { data: values, refetch, isLoading } = useMasterValues(groupKey, true, false);
  const { data: groups, refetch: refetchGroups } = useMasterGroups();
  
  const [label, setLabel] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [optimisticToggles, setOptimisticToggles] = useState<Record<string, boolean>>({});

  // Automatically clear optimistic state once the real server data catches up
  useEffect(() => {
    if (values) {
      setOptimisticToggles((prev) => {
        const next = { ...prev };
        let changed = false;
        values.forEach((v) => {
          if (next[v.id] === v.isActive) {
            delete next[v.id];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }
  }, [values]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label) return;
    setIsSubmitting(true);
    setError("");

    try {
      const finalValue = label.toLowerCase().replace(/[^a-z0-9_]/g, "_");

      // Prevent duplicate submissions to avoid database unique constraint errors
      if (values?.some((v) => v.value === finalValue || v.label.toLowerCase() === label.trim().toLowerCase())) {
        setError(`"${label.trim()}" already exists in this list.`);
        setIsSubmitting(false);
        return;
      }

      // Auto-create Master Group if it doesn't exist yet
      const groupExists = groups?.find((g) => g.key === groupKey);
      if (!groupExists) {
        await authedFetch("/api/master/groups", {
          method: "POST",
          body: JSON.stringify({ key: groupKey, name: groupName }),
        });
        await refetchGroups();
      }

      // Create the new Master Value
      await authedFetch("/api/master/values", {
        method: "POST",
        body: JSON.stringify({
          groupKey,
          label,
          value: finalValue,
          sortOrder: values ? values.length + 1 : 0,
          isActive: true,
        }),
      });

      setLabel("");
      await refetch();
    } catch (err: any) {
      setError(err.message || "Failed to add value");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggle = async (id: string, currentStatus: boolean) => {
    const nextStatus = !currentStatus;
    setError(""); // 1. Clear any previous errors immediately on click
    setOptimisticToggles((prev) => ({ ...prev, [id]: nextStatus }));
    try {
      await authedFetch("/api/master/values", {
        method: "PATCH",
        body: JSON.stringify({ id, isActive: nextStatus }),
      });
      await refetch();
      
    } catch (err: any) {
      // 2. Safely revert to the true server state by deleting our optimistic assumption
      setOptimisticToggles((prev) => {
        const next = { ...prev };
        delete next[id]; 
        return next;
      });
      setError(err.message || "Failed to update status");
    }
  };

  const startEdit = (id: string, currentLabel: string) => {
    setEditingId(id);
    setEditLabel(currentLabel);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditLabel("");
  };

  const removeValue = async (id: string) => {
    setError("");
    try {
      await authedFetch(`/api/master/value/${id}`, { method: "DELETE" });
      await refetch();
    } catch (err: any) {
      setError(err.message || "Failed to delete item");
    }
  };

  const saveEdit = async (id: string) => {
    if (!editLabel) return;
    try {
      await authedFetch("/api/master/values", {
        method: "PATCH",
        body: JSON.stringify({ id, label: editLabel }),
      });
      setEditingId(null);
      await refetch();
    } catch (err: any) {
      setError(err.message || "Failed to update item");
    }
  };

  return (
    <div className="rounded-xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
      <h3 className="mb-4 font-semibold text-[#4A1D1F]">{groupName} ({groupKey})</h3>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          className="w-full rounded-md border border-[#E8DCC8] px-3 py-2 text-sm outline-none focus:border-[#7B3010]"
          placeholder="Label (e.g. Processing)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
        />
        <button disabled={isSubmitting} className="cursor-pointer rounded-md bg-[#4A1D1F] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed">
          Add
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-4 flex flex-col gap-1 max-h-64 overflow-y-auto">
        {isLoading ? <p className="text-xs text-gray-500">Loading...</p> : values?.map((v) => {
          const isActive = optimisticToggles[v.id] !== undefined ? optimisticToggles[v.id] : v.isActive;
          return (
            <div key={v.id} className="flex justify-between items-center rounded-md bg-gray-50 px-3 py-2 text-sm border border-gray-100 min-h-[40px]">
            {editingId === v.id ? (
              <div className="flex flex-1 items-center gap-2 mr-2">
                <input
                  className="w-full rounded border border-[#E8DCC8] px-2 py-1 text-sm outline-none focus:border-[#7B3010]"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  autoFocus
                />
                <button type="button" onClick={() => saveEdit(v.id)} className="cursor-pointer text-green-600 hover:text-green-800">
                  <Check size={16} />
                </button>
                <button type="button" onClick={cancelEdit} className="cursor-pointer text-red-600 hover:text-red-800">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <>
                <span className={isActive ? "text-gray-900" : "text-gray-400 line-through"}>{v.label}</span>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => startEdit(v.id, v.label)} className="cursor-pointer text-gray-400 hover:text-[#7B3010] transition-colors">
                    <Edit2 size={14} />
                  </button>
                  <button type="button" onClick={() => void removeValue(v.id)} className="cursor-pointer text-gray-400 hover:text-red-600 transition-colors" title="Delete">
                    <Trash2 size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggle(v.id, isActive)}
                    className={`relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full transition-colors focus:outline-none ${isActive ? 'bg-[#7B3010]' : 'bg-gray-300'}`}
                  >
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${isActive ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </div>
              </>
            )}
          </div>
        );})}
      </div>
    </div>
  );
}