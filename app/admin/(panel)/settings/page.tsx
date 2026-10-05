"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch, authedPost } from "@/lib/dashboard-fetch";
import { uploadAdminImage } from "@/lib/admin-upload";
import { ConsoleTable, ConsoleTd } from "@/components/dashboard/ConsoleTable";
import LocationCreatorForm from "../../../../components/ui/LocationCreatorForm";
import { useLocations } from "../../../../hooks/useLocations";
import MasterDataCreatorForm from "../../../../components/ui/MasterDataCreatorForm";
import { Trash2, Loader2, Save, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_SHIPPING_RULES,
  validateShippingRules,
  type ShippingRule,
} from "@/src/lib/shipping/ziply5-shipping";

type SettingRow = {
  id: string;
  group: string;
  key: string;
  valueJson: unknown;
};

type StorefrontSeoForm = {
  storeName: string;
  tagline: string;
  defaultMetaTitle: string;
  defaultMetaDescription: string;
  canonicalBaseUrl: string;
  defaultOgImageUrl: string;
  twitterSite: string;
};

const emptySeoForm = (): StorefrontSeoForm => ({
  storeName: "",
  tagline: "",
  defaultMetaTitle: "",
  defaultMetaDescription: "",
  canonicalBaseUrl: "",
  defaultOgImageUrl: "",
  twitterSite: "",
});

export default function AdminSettingsPage() {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"generic" | "locations" | "master_data" | "seo" | "tax" | "cart">("generic");
  const [seoForm, setSeoForm] = useState<StorefrontSeoForm>(emptySeoForm);
  const [seoLoading, setSeoLoading] = useState(false);
  const [seoSaving, setSeoSaving] = useState(false);
  const [seoError, setSeoError] = useState("");
  const [ogImageUploading, setOgImageUploading] = useState(false);
  const [taxValue, setTaxValue] = useState<number | string>("");
  const [taxLoading, setTaxLoading] = useState(false);
  const [taxSaving, setTaxSaving] = useState(false);
  const [taxError, setTaxError] = useState("");

  const [cartMinOrderValue, setCartMinOrderValue] = useState<number | string>("");
  const [cartLoading, setCartLoading] = useState(false);
  const [cartSaving, setCartSaving] = useState(false);
  const [cartError, setCartError] = useState("");

  const [shippingRules, setShippingRules] = useState<
    Array<{
      id: string;
      minSubtotal: number | string;
      maxSubtotal: number | string;
      shippingCharge: number | string;
      active: boolean;
      isOpenEnded?: boolean;
    }>
  >([]);
  const [shippingLoading, setShippingLoading] = useState(false);
  const [shippingSaving, setShippingSaving] = useState(false);
  const [shippingError, setShippingError] = useState("");
  const [shippingSuccess, setShippingSuccess] = useState("");

  const { data: warehouses, refetch: refetchWarehouses, loading: loadingWarehouses } = useLocations("warehouse", undefined);
  const { data: states, refetch: refetchStates, loading: loadingStates } = useLocations("state", undefined);
  const { data: cities, refetch: refetchCities, loading: loadingCities } = useLocations("city", undefined);


  const load = useCallback(() => {
    setLoading(true);
    setError("");
    authedFetch<SettingRow[]>("/api/v1/settings")
      .then(setRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (activeTab !== "seo") return;
    let cancelled = false;
    setSeoLoading(true);
    setSeoError("");
    authedFetch<SettingRow[]>("/api/v1/settings?group=seo")
      .then((list) => {
        if (cancelled) return;
        const row = list.find((r) => r.key === "storefront");
        const raw = row?.valueJson;
        const o =
          raw != null && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : {};
        const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
        setSeoForm({
          storeName: s("storeName"),
          tagline: s("tagline"),
          defaultMetaTitle: s("defaultMetaTitle"),
          defaultMetaDescription: s("defaultMetaDescription"),
          canonicalBaseUrl: s("canonicalBaseUrl"),
          defaultOgImageUrl: s("defaultOgImageUrl"),
          twitterSite: s("twitterSite"),
        });
      })
      .catch((e: Error) => {
        if (!cancelled) setSeoError(e.message);
      })
      .finally(() => {
        if (!cancelled) setSeoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "tax") return;
    let cancelled = false;
    setTaxLoading(true);
    setTaxError("");
    authedFetch<SettingRow[]>("/api/v1/settings?group=TAX")
      .then((list) => {
        if (cancelled) return;
        const row = list.find((r) => r.key === "percentage");
        if (row && row.valueJson != null) {
          setTaxValue(String(row.valueJson));
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setTaxError(e.message);
      })
      .finally(() => {
        if (!cancelled) setTaxLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const saveTaxSettings = async () => {
    const val = Number(taxValue);
    if (taxValue === "" || isNaN(val) || val < 0 || val > 100) {
      setTaxError("Tax percentage must be between 0 and 100");
      return;
    }
    setTaxSaving(true);
    setTaxError("");
    try {
      await authedPost("/api/v1/settings", {
        group: "TAX",
        key: "percentage",
        valueJson: val,
      });
    } catch (e: unknown) {
      setTaxError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setTaxSaving(false);
    }
  };

  useEffect(() => {
    if (activeTab !== "cart") return;
    let cancelled = false;
    setCartLoading(true);
    setCartError("");
    authedFetch<SettingRow[]>("/api/v1/settings?group=CART")
      .then((list) => {
        if (cancelled) return;
        const row = list.find((r) => r.key === "min_order_value");
        if (row && row.valueJson != null) {
          setCartMinOrderValue(String(row.valueJson));
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setCartError(e.message);
      })
      .finally(() => {
        if (!cancelled) setCartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const saveCartSettings = async () => {
    const val = Number(cartMinOrderValue);
    if (cartMinOrderValue === "" || isNaN(val) || val < 0) {
      setCartError("Minimum cart value must be a valid number greater than or equal to 0");
      return;
    }
    setCartSaving(true);
    setCartError("");
    try {
      await authedPost("/api/v1/settings", {
        group: "CART",
        key: "min_order_value",
        valueJson: val,
      });
    } catch (e: unknown) {
      setCartError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setCartSaving(false);
    }
  };

  useEffect(() => {
    if (activeTab !== "generic") return;
    let cancelled = false;
    setShippingLoading(true);
    setShippingError("");
    setShippingSuccess("");
    authedFetch<SettingRow[]>("/api/v1/settings?group=SHIPPING")
      .then((list) => {
        if (cancelled) return;
        const row = list.find((r) => r.key === "rules");
        if (row && Array.isArray(row.valueJson) && row.valueJson.length > 0) {
          setShippingRules(
            (row.valueJson as any[]).map((r, i, arr) => ({
              id: r.id || `rule_${i + 1}`,
              minSubtotal: r.minSubtotal ?? 0,
              maxSubtotal: r.maxSubtotal != null ? r.maxSubtotal : "",
              shippingCharge: r.shippingCharge ?? 0,
              active: r.active !== false,
              isOpenEnded: i === arr.length - 1 && r.maxSubtotal == null,
            }))
          );
        } else {
          setShippingRules(
            DEFAULT_SHIPPING_RULES.map((r, i, arr) => ({
              id: r.id,
              minSubtotal: r.minSubtotal,
              maxSubtotal: r.maxSubtotal != null ? r.maxSubtotal : "",
              shippingCharge: r.shippingCharge,
              active: r.active,
              isOpenEnded: i === arr.length - 1 && r.maxSubtotal == null,
            }))
          );
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setShippingError(e.message);
      })
      .finally(() => {
        if (!cancelled) setShippingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const addShippingRule = () => {
    setShippingRules((prev) => {
      // Prior rules cannot be open-ended; convert prior last rule to finite
      const updatedPrev = prev.map((r, i) => {
        if (i === prev.length - 1 && r.isOpenEnded) {
          const estimatedMax = Number(r.minSubtotal) > 0 ? Number(r.minSubtotal) * 2 : 1000;
          return {
            ...r,
            isOpenEnded: false,
            maxSubtotal: r.maxSubtotal !== "" && r.maxSubtotal != null ? r.maxSubtotal : estimatedMax,
          };
        }
        return r;
      });
      const last = updatedPrev[updatedPrev.length - 1];
      const nextMin =
        last && last.maxSubtotal !== ""
          ? Number(last.maxSubtotal)
          : 0;
      return [
        ...updatedPrev,
        {
          id: `rule_${Date.now()}`,
          minSubtotal: isNaN(nextMin) ? 0 : nextMin,
          maxSubtotal: "",
          shippingCharge: 0,
          active: true,
          isOpenEnded: true,
        },
      ];
    });
  };

  const removeShippingRule = (index: number) => {
    setShippingRules((prev) => prev.filter((_, i) => i !== index));
  };

  const updateShippingRule = (
    index: number,
    updates: Partial<{
      id: string;
      minSubtotal: number | string;
      maxSubtotal: number | string;
      shippingCharge: number | string;
      active: boolean;
      isOpenEnded: boolean;
    }>
  ) => {
    setShippingRules((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...updates } : r))
    );
  };

  const saveShippingRules = async () => {
    setShippingSaving(true);
    setShippingError("");
    setShippingSuccess("");

    if (shippingRules.length === 0) {
      setShippingError("Please add at least one shipping rule.");
      setShippingSaving(false);
      return;
    }

    const formattedRules = shippingRules.map((r, i) => {
      const isLast = i === shippingRules.length - 1;
      const min = Number(r.minSubtotal);
      const charge = Number(r.shippingCharge);
      // Only the last rule supports an open-ended (null) upper limit
      const max =
        isLast && (r.isOpenEnded || r.maxSubtotal === "" || r.maxSubtotal == null)
          ? null
          : Number(r.maxSubtotal);
      return {
        id: r.id || `rule_${i + 1}`,
        minSubtotal: isNaN(min) ? 0 : min,
        maxSubtotal: max,
        shippingCharge: isNaN(charge) ? 0 : charge,
        active: Boolean(r.active),
      };
    });

    const validation = validateShippingRules(formattedRules);
    if (!validation.valid) {
      setShippingError(validation.errors.join("; "));
      setShippingSaving(false);
      return;
    }

    try {
      await authedPost("/api/v1/settings", {
        group: "SHIPPING",
        key: "rules",
        valueJson: formattedRules,
      });
      setShippingSuccess("Shipping rules saved successfully.");
      setTimeout(() => setShippingSuccess(""), 4000);
    } catch (e: unknown) {
      setShippingError(e instanceof Error ? e.message : "Failed to save shipping rules.");
    } finally {
      setShippingSaving(false);
    }
  };

  const saveStorefrontSeo = async () => {
    setSeoSaving(true);
    setSeoError("");
    const trim = (x: string) => {
      const t = x.trim();
      return t.length ? t : null;
    };
    try {
      await authedPost("/api/v1/settings", {
        group: "seo",
        key: "storefront",
        valueJson: {
          storeName: trim(seoForm.storeName),
          tagline: trim(seoForm.tagline),
          defaultMetaTitle: trim(seoForm.defaultMetaTitle),
          defaultMetaDescription: trim(seoForm.defaultMetaDescription),
          canonicalBaseUrl: trim(seoForm.canonicalBaseUrl),
          defaultOgImageUrl: trim(seoForm.defaultOgImageUrl),
          twitterSite: trim(seoForm.twitterSite),
        },
      });
    } catch (e: unknown) {
      setSeoError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSeoSaving(false);
    }
  };

  const preview = (v: unknown) => {
    try {
      return JSON.stringify(v).slice(0, 120) + (JSON.stringify(v).length > 120 ? "…" : "");
    } catch {
      return "—";
    }
  };

  const handleLocationChange = () => {
    refetchWarehouses();
    refetchStates();
    refetchCities();
  };

  const handleDeleteLocation = async (type: 'warehouse' | 'state' | 'city', identifier: { id?: string, key?: string }) => {
    if (!window.confirm(`Are you sure you want to delete this ${type}? This might also delete associated cities.`)) return;

    try {
      await authedFetch('/api/admin/locations', {
        method: 'DELETE',
        body: JSON.stringify({ type, ...identifier })
      });
      handleLocationChange(); // refetch all
    } catch (err: any) {
      alert(`Error deleting ${type}: ${err.message}`);
    }
  };
  return (
    <section className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Settings</h1>
          {/* <p className="text-sm text-[#646464]">Key–value store for shop config and location masters.</p> */}
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="rounded-full border border-[#E8DCC8] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#4A1D1F] hover:bg-[#FFFBF3]"
        >
          Refresh
        </button>
      </div>

      <div className="flex gap-4 border-b border-[#E8DCC8]">
        <button
          className={`pb-2 text-sm font-semibold cursor-pointer transition-colors ${activeTab === 'generic' ? 'border-b-2 border-[#7B3010] text-[#7B3010]' : 'text-[#646464] hover:text-[#2A1810]'}`}
          onClick={() => setActiveTab('generic')}
        >
          Generic Settings
        </button>
        <button
          className={`pb-2 text-sm font-semibold cursor-pointer transition-colors ${activeTab === 'locations' ? 'border-b-2 border-[#7B3010] text-[#7B3010]' : 'text-[#646464] hover:text-[#2A1810]'}`}
          onClick={() => setActiveTab('locations')}
        >
          Location Management
        </button>
        <button
          className={`pb-2 text-sm font-semibold cursor-pointer transition-colors ${activeTab === 'seo' ? 'border-b-2 border-[#7B3010] text-[#7B3010]' : 'text-[#646464] hover:text-[#2A1810]'}`}
          onClick={() => setActiveTab('seo')}
        >
          SEO & storefront
        </button>
        <button
          className={`pb-2 text-sm font-semibold cursor-pointer transition-colors ${activeTab === 'tax' ? 'border-b-2 border-[#7B3010] text-[#7B3010]' : 'text-[#646464] hover:text-[#2A1810]'}`}
          onClick={() => setActiveTab('tax')}
        >
          Tax Settings
        </button>
        <button
          className={`pb-2 text-sm font-semibold cursor-pointer transition-colors ${activeTab === 'cart' ? 'border-b-2 border-[#7B3010] text-[#7B3010]' : 'text-[#646464] hover:text-[#2A1810]'}`}
          onClick={() => setActiveTab('cart')}
        >
          Cart Settings
        </button>
        {/* <button
          className={`pb-2 text-sm font-semibold cursor-pointer transition-colors ${activeTab === 'master_data' ? 'border-b-2 border-[#7B3010] text-[#7B3010]' : 'text-[#646464] hover:text-[#2A1810]'}`}
          onClick={() => setActiveTab('master_data')}
        >
          Dropdowns 
        </button> */}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-[#646464]">Loading…</p>}

      {!loading && activeTab === 'generic' && (
        <div className="rounded-2xl border border-[#E8DCC8] bg-white p-6 shadow-sm space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-melon text-xl font-bold text-[#4A1D1F]">
                Shipping Rules & Charges
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-[#646464]">
                Configure tiered shipping rates based on the merchandise subtotal (₹).
                Ranges are lower-inclusive and upper-exclusive [Min, Max), with an optional open-ended final tier [Min, ∞).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={addShippingRule}
                disabled={shippingSaving || shippingLoading}
                className="gap-2 rounded-full border-[#7B3010] text-[#7B3010] hover:bg-[#FFFBF3]"
              >
                <Plus className="h-4 w-4" />
                Add Range
              </Button>
              <Button
                type="button"
                onClick={() => void saveShippingRules()}
                disabled={shippingSaving || shippingLoading}
                className="gap-2 rounded-full bg-[#7B3010] hover:bg-[#5c240c] text-white"
              >
                {shippingSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {shippingSaving ? "Saving…" : "Save Rules"}
              </Button>
            </div>
          </div>

          {shippingError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {shippingError}
            </p>
          )}
          {shippingSuccess && (
            <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
              {shippingSuccess}
            </p>
          )}

          {shippingLoading ? (
            <p className="text-sm text-[#646464]">Loading shipping settings…</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#E8DCC8] bg-white shadow-sm">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead className="bg-[#4A1D1F] text-[11px] font-semibold uppercase tracking-wide text-[#F5F1E6]">
                  <tr>
                    <th className="px-3 py-2.5 md:px-4">Min Subtotal (₹)</th>
                    <th className="px-3 py-2.5 md:px-4">Max Subtotal (₹)</th>
                    <th className="px-3 py-2.5 md:px-4">Shipping Charge (₹)</th>
                    <th className="px-3 py-2.5 md:px-4 text-center">Active</th>
                    <th className="px-3 py-2.5 md:px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8DCC8] text-[#333]">
                  {shippingRules.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-sm text-[#646464]">
                        No shipping rules defined. Click &ldquo;Add Range&rdquo; to create one.
                      </td>
                    </tr>
                  ) : (
                    shippingRules.map((rule, idx) => {
                      const isLast = idx === shippingRules.length - 1;
                      return (
                      <tr key={rule.id || idx} className="hover:bg-[#FFFBF3]/50">
                        <td className="px-3 py-3 md:px-4">
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            value={rule.minSubtotal}
                            onChange={(e) =>
                              updateShippingRule(idx, { minSubtotal: e.target.value })
                            }
                            className="w-32 border-[#E8DCC8]"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-3 py-3 md:px-4">
                          <div className="flex items-center gap-2">
                            {isLast && rule.isOpenEnded ? (
                              <span className="text-sm font-medium text-[#7B3010] py-1">
                                No Limit (∞)
                              </span>
                            ) : (
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                value={rule.maxSubtotal}
                                onChange={(e) =>
                                  updateShippingRule(idx, { maxSubtotal: e.target.value })
                                }
                                className="w-32 border-[#E8DCC8]"
                                placeholder="1000"
                              />
                            )}
                            {isLast && (
                              <label className="flex items-center gap-1.5 text-xs text-[#646464] cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={Boolean(rule.isOpenEnded)}
                                  onChange={(e) =>
                                    updateShippingRule(idx, {
                                      isOpenEnded: e.target.checked,
                                      maxSubtotal: e.target.checked ? "" : rule.maxSubtotal,
                                    })
                                  }
                                  className="rounded border-[#E8DCC8] text-[#7B3010] focus:ring-[#7B3010]"
                                />
                                No Max
                              </label>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 md:px-4">
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            value={rule.shippingCharge}
                            onChange={(e) =>
                              updateShippingRule(idx, { shippingCharge: e.target.value })
                            }
                            className="w-32 border-[#E8DCC8]"
                            placeholder="125"
                          />
                        </td>
                        <td className="px-3 py-3 md:px-4 text-center">
                          <Switch
                            checked={rule.active}
                            onCheckedChange={(checked) =>
                              updateShippingRule(idx, { active: checked })
                            }
                          />
                        </td>
                        <td className="px-3 py-3 md:px-4 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeShippingRule(idx)}
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!loading && activeTab === "seo" && (
        <div className="rounded-2xl border border-[#E8DCC8] bg-white p-6 shadow-sm space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-melon text-xl font-bold text-[#4A1D1F]">SEO & storefront identity</h2>
              <p className="mt-1 max-w-2xl text-sm text-[#646464]">
                Defaults for the public shop: site title, descriptions, canonical URL, and sharing images. Product and CMS pages can override where supported.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => void saveStorefrontSeo()}
              disabled={seoSaving || seoLoading}
              className="gap-2 rounded-full bg-[#7B3010] hover:bg-[#5c240c]"
            >
              {seoSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {seoSaving ? "Saving…" : "Save"}
            </Button>
          </div>
          {seoError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{seoError}</p> : null}
          {seoLoading ? (
            <p className="text-sm text-[#646464]">Loading SEO settings…</p>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="seo-store-name">Store name</Label>
                <Input
                  id="seo-store-name"
                  value={seoForm.storeName}
                  onChange={(e) => setSeoForm((p) => ({ ...p, storeName: e.target.value }))}
                  placeholder="ZIPLY5"
                  className="border-[#E8DCC8]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="seo-tagline">Tagline</Label>
                <Input
                  id="seo-tagline"
                  value={seoForm.tagline}
                  onChange={(e) => setSeoForm((p) => ({ ...p, tagline: e.target.value }))}
                  placeholder="Nothing artificial. Everything delicious."
                  className="border-[#E8DCC8]"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="seo-default-title">Default meta title</Label>
                <Input
                  id="seo-default-title"
                  value={seoForm.defaultMetaTitle}
                  onChange={(e) => setSeoForm((p) => ({ ...p, defaultMetaTitle: e.target.value }))}
                  placeholder="Leave empty to use “Store name — Tagline”"
                  className="border-[#E8DCC8]"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="seo-default-desc">Default meta description</Label>
                <Textarea
                  id="seo-default-desc"
                  value={seoForm.defaultMetaDescription}
                  onChange={(e) => setSeoForm((p) => ({ ...p, defaultMetaDescription: e.target.value }))}
                  placeholder="Store-wide default for search snippets when a page does not define its own description."
                  rows={4}
                  className="border-[#E8DCC8]"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="seo-canonical">Canonical site URL</Label>
                <Input
                  id="seo-canonical"
                  value={seoForm.canonicalBaseUrl}
                  onChange={(e) => setSeoForm((p) => ({ ...p, canonicalBaseUrl: e.target.value }))}
                  placeholder="https://your-store.example.com"
                  className="border-[#E8DCC8]"
                />
                <p className="text-xs text-[#646464]">Used as metadataBase for absolute URLs in metadata.</p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="seo-og">Default Open Graph image</Label>
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#E8DCC8] bg-[#FFFBF3]/40 p-3">
                  {seoForm.defaultOgImageUrl ? (
                    <img
                      src={seoForm.defaultOgImageUrl}
                      alt=""
                      className="h-20 max-w-[200px] rounded-md border border-[#E8DCC8] object-contain bg-white"
                    />
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id="seo-og"
                      type="file"
                      accept="image/*"
                      disabled={ogImageUploading}
                      className="max-w-xs cursor-pointer border-[#E8DCC8] text-sm file:cursor-pointer"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (!f || !f.type.startsWith("image/")) return;
                        setOgImageUploading(true);
                        void uploadAdminImage(f, "site/seo")
                          .then((url) => {
                            if (url) setSeoForm((p) => ({ ...p, defaultOgImageUrl: url }));
                          })
                          .catch(() => setSeoError("OG image upload failed"))
                          .finally(() => setOgImageUploading(false));
                      }}
                    />
                    {ogImageUploading ? <Loader2 className="h-4 w-4 animate-spin text-[#7B3010]" /> : null}
                    {seoForm.defaultOgImageUrl ? (
                      <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setSeoForm((p) => ({ ...p, defaultOgImageUrl: "" }))}>
                        Clear image
                      </Button>
                    ) : null}
                  </div>
                </div>
                <p className="text-xs text-[#646464]">Upload an image file; no manual URL entry.</p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="seo-twitter">Twitter / X handle (optional)</Label>
                <Input
                  id="seo-twitter"
                  value={seoForm.twitterSite}
                  onChange={(e) => setSeoForm((p) => ({ ...p, twitterSite: e.target.value }))}
                  placeholder="@yourbrand"
                  className="border-[#E8DCC8]"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && activeTab === 'locations' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <LocationCreatorForm type="warehouse" onSuccess={handleLocationChange} />
            <LocationCreatorForm type="state" onSuccess={handleLocationChange} />
            <LocationCreatorForm type="city" onSuccess={handleLocationChange} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
            {/* Warehouses List */}
            <div>
              <h3 className="font-semibold text-[#4A1D1F] mb-2">Warehouses</h3>
              <div className="bg-white p-2 rounded-xl border border-[#E8DCC8] shadow-sm space-y-1 max-h-96 overflow-y-auto">
                {loadingWarehouses ? <p className="p-2 text-sm text-gray-500">Loading...</p> : warehouses?.map(w => (
                  <div key={w.value} className="flex justify-between items-center p-2 hover:bg-gray-50 rounded-lg">
                    <span className="text-sm">{w.label}</span>
                    <button onClick={() => handleDeleteLocation('warehouse', { id: w.value })} className="text-red-500 hover:text-red-700 p-1 rounded-full hover:bg-red-100">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* States List */}
            <div>
              <h3 className="font-semibold text-[#4A1D1F] mb-2">States</h3>
              <div className="bg-white p-2 rounded-xl border border-[#E8DCC8] shadow-sm space-y-1 max-h-96 overflow-y-auto">
                {loadingStates ? <p className="p-2 text-sm text-gray-500">Loading...</p> : states?.map(s => (
                  <div key={s.value} className="flex justify-between items-center p-2 hover:bg-gray-50 rounded-lg">
                    <span className="text-sm">{s.label} ({s.value})</span>
                    <button onClick={() => handleDeleteLocation('state', { key: s.label })} className="text-red-500 hover:text-red-700 p-1 rounded-full hover:bg-red-100">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Cities List */}
            <div>
              <h3 className="font-semibold text-[#4A1D1F] mb-2">Cities</h3>
              <div className="bg-white p-2 rounded-xl border border-[#E8DCC8] shadow-sm space-y-1 max-h-96 overflow-y-auto">
                {loadingCities ? <p className="p-2 text-sm text-gray-500">Loading...</p> : cities?.map(c => (
                  <div key={c.value} className="flex justify-between items-center p-2 hover:bg-gray-50 rounded-lg">
                    <span className="text-sm">{c.label}</span>
                    <button onClick={() => handleDeleteLocation('city', { key: c.label })} className="text-red-500 hover:text-red-700 p-1 rounded-full hover:bg-red-100">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {!loading && activeTab === 'master_data' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <MasterDataCreatorForm groupKey="ORDER_STATUSES" groupName="Order Statuses" />
          {/* <MasterDataCreatorForm groupKey="RETURN_REASONS" groupName="Return Reasons" /> */}
        </div>
      )}
      {!loading && activeTab === 'tax' && (
        <div className="rounded-2xl border border-[#E8DCC8] bg-white p-6 shadow-sm space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-melon text-xl font-bold text-[#4A1D1F]">Tax Settings</h2>
              <p className="mt-1 max-w-2xl text-sm text-[#646464]">
                Configure the default tax percentage applied to orders.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => void saveTaxSettings()}
              disabled={taxSaving || taxLoading}
              className="gap-2 rounded-full bg-[#7B3010] hover:bg-[#5c240c]"
            >
              {taxSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {taxSaving ? "Saving…" : "Save"}
            </Button>
          </div>
          {taxError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{taxError}</p> : null}
          {taxLoading ? (
            <p className="text-sm text-[#646464]">Loading tax settings…</p>
          ) : (
            <div className="max-w-xs space-y-2">
              <Label htmlFor="tax-percentage">Tax Percentage (%)</Label>
              <Input
                id="tax-percentage"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={taxValue}
                onChange={(e) => setTaxValue(e.target.value)}
                placeholder="0.00"
                className="border-[#E8DCC8]"
              />
              <p className="text-xs text-[#646464]">Enter a value between 0 and 100.</p>
            </div>
          )}
        </div>
      )}
      {!loading && activeTab === 'cart' && (
        <div className="rounded-2xl border border-[#E8DCC8] bg-white p-6 shadow-sm space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-melon text-xl font-bold text-[#4A1D1F]">Cart Settings</h2>
              <p className="mt-1 max-w-2xl text-sm text-[#646464]">
                Configure the minimum order/cart value required for customers to proceed to checkout.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => void saveCartSettings()}
              disabled={cartSaving || cartLoading}
              className="gap-2 rounded-full bg-[#7B3010] hover:bg-[#5c240c]"
            >
              {cartSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {cartSaving ? "Saving…" : "Save"}
            </Button>
          </div>
          {cartError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{cartError}</p> : null}
          {cartLoading ? (
            <p className="text-sm text-[#646464]">Loading cart settings…</p>
          ) : (
            <div className="max-w-xs space-y-2">
              <Label htmlFor="min-cart-value">Minimum Cart Value (INR)</Label>
              <Input
                id="min-cart-value"
                type="number"
                min="0"

                value={cartMinOrderValue}
                onChange={(e) => setCartMinOrderValue(e.target.value)}
                placeholder="0"
                className="border-[#E8DCC8]"
              />
              <p className="text-xs text-[#646464]">Customers must have at least this amount in their cart to checkout.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
