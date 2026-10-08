"use client"

import { useEffect, useState } from "react"
import { authedFetch } from "@/lib/dashboard-fetch"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Mail, Phone, Clock, Search, User } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { toast } from "@/lib/toast"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type ContactMessage = {
  id: string | number
  name: string
  email: string
  phone?: string
  message: string
  status?: string
  createdAt: string
}

type NewsletterSubscriber = {
  id: string
  email: string
  createdAt: string
}

export default function AdminInboxPage() {
  const [messages, setMessages] = useState<ContactMessage[]>([])
  const [subscribers, setSubscribers] = useState<NewsletterSubscriber[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [activeTab, setActiveTab] = useState("contact")
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [updating, setUpdating] = useState<string | number | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [contactRes, newsRes] = await Promise.all([
          authedFetch<any>("/api/v1/contact").catch(() => null),
          authedFetch<any>("/api/v1/newsletter").catch(() => null)
        ])

        if (contactRes && contactRes.data) setMessages(contactRes.data)
        else if (Array.isArray(contactRes)) setMessages(contactRes)

        if (newsRes && newsRes.data) setSubscribers(newsRes.data)
        else if (Array.isArray(newsRes)) setSubscribers(newsRes)
      } catch (err) {
        console.error("Failed to fetch data:", err)
        setError("Failed to load inbox data.")
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#4A1D1F]" />
      </div>
    )
  }

  const handleStatusChange = async (id: string | number, newStatus: string) => {
    setUpdating(id)
    try {
      const token = window.localStorage.getItem("ziply5_access_token")
      const res = await fetch("/api/v1/contact", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ id, status: newStatus })
      })
      const json = await res.json()
      if (json.success) {
        setMessages((prev) => prev.map(m => m.id === id ? { ...m, status: newStatus } : m))
        toast.success("Status Updated", "The inquiry status has been changed.")
      } else {
        toast.error("Error", json.message || "Failed to update status")
      }
    } catch (err) {
      console.error(err)
      toast.error("Network Error", "Could not connect to the server.")
    } finally {
      setUpdating(null)
    }
  }

  const filteredMessages = messages.filter((msg) => {
    const matchesSearch = msg.name.toLowerCase().includes(searchQuery.toLowerCase()) || msg.email.toLowerCase().includes(searchQuery.toLowerCase()) || msg.message.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || (msg.status || 'open') === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="w-full space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-melon text-2xl font-bold text-[#4A1D1F]">Inbox</h1>
          <p className="text-sm text-[#646464]">
            View and manage contact form submissions.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 w-full">
        <TabsList className="w-full flex">
          <TabsTrigger value="contact" className="flex-1 data-[state=active]:bg-primary data-[state=active]:text-white">Contact</TabsTrigger>
          <TabsTrigger value="newsletter" className="flex-1 data-[state=active]:bg-primary data-[state=active]:text-white">News Letter</TabsTrigger>
        </TabsList>

        <TabsContent value="contact" className="space-y-4 mt-0">
          <div className="flex gap-4 items-center mb-4">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#646464]" />
              <Input 
                placeholder="Search messages..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-10 border-[#E8DCC8]"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
              <SelectTrigger className="!h-10 w-[160px] rounded-md border border-[#E8DCC8] bg-white text-sm text-[#646464] shadow-none focus:ring-2 focus:ring-primary/20 outline-none">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="open">Not Contacted</SelectItem>
                <SelectItem value="contacted">Contacted</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error ? (
            <Card className="border-[#E8DCC8]">
              <CardContent className="p-4 text-red-600">{error}</CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#E8DCC8] bg-white shadow-sm">
              <table className="w-full text-left text-sm text-[#646464]">
                <thead className="bg-[#FFFBF3]/80 text-xs uppercase text-[#4A1D1F] border-b border-[#E8DCC8]">
                  <tr>
                    <th className="px-4 py-4 font-bold">Name</th>
                    <th className="px-4 py-4 font-bold">Contact Info</th>
                    <th className="px-4 py-4 font-bold">Message</th>
                    <th className="px-4 py-4 font-bold whitespace-nowrap">Date</th>
                    <th className="px-4 py-4 font-bold text-center">Status</th>
                    <th className="px-4 py-4 font-bold text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8DCC8]">
                  {filteredMessages.map((msg) => (
                    <tr key={msg.id} className="hover:bg-[#FFFBF3]/30 transition-colors">
                      <td className="px-4 py-3 font-semibold text-gray-900">{msg.name}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-col gap-1.5">
                          <a href={`mailto:${msg.email}`} className="hover:underline flex items-center gap-1.5 text-[#4A1D1F]"><Mail className="h-3 w-3" /> {msg.email}</a>
                          {msg.phone && <a href={`tel:${msg.phone}`} className="hover:underline flex items-center gap-1.5 text-[#4A1D1F]"><Phone className="h-3 w-3" /> {msg.phone}</a>}
                        </div>
                      </td>
                      <td className="px-4 py-3 min-w-[200px] max-w-sm">
                        <p className="line-clamp-2 text-xs leading-relaxed" title={msg.message}>{msg.message}</p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs">
                        <div className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> {new Date(msg.createdAt).toLocaleDateString()}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Select
                          value={msg.status || 'open'}
                          onValueChange={(v) => handleStatusChange(msg.id, v)}
                          disabled={updating === msg.id}
                        >
                          <SelectTrigger
                            size="sm"
                            className={`w-full min-w-[150px] border rounded-md px-2 py-1.5 text-xs font-bold outline-none cursor-pointer uppercase tracking-wider shadow-none ${
                              (msg.status === 'contacted') ? 'bg-green-50 text-green-700 border-green-200' : 'bg-orange-50 text-orange-700 border-orange-200'
                            }`}
                          >
                            <SelectValue placeholder="Status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="open">Not Contacted</SelectItem>
                            <SelectItem value="contacted">Contacted</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <a href={`mailto:${msg.email}`} className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-[#FFFBF3] border border-[#E8DCC8] text-[#4A1D1F] hover:bg-[#4A1D1F] hover:text-white transition-colors" title="Reply via Email">
                          <Mail className="h-3.5 w-3.5" />
                        </a>
                      </td>
                    </tr>
                  ))}
                  {filteredMessages.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-[#646464]">
                        {messages.length === 0 ? "No messages found." : "No messages match your filters."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="newsletter">
          {error ? (
            <Card className="border-[#E8DCC8]">
              <CardContent className="p-4 text-red-600">{error}</CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#E8DCC8] bg-white shadow-sm">
              <table className="w-full text-left text-sm text-[#646464]">
                <thead className="bg-[#FFFBF3]/80 text-xs uppercase text-[#4A1D1F] border-b border-[#E8DCC8]">
                  <tr>
                    <th className="px-4 py-4 font-bold">Email</th>
                    <th className="px-4 py-4 font-bold whitespace-nowrap">Subscribed Date</th>
                    <th className="px-4 py-4 font-bold text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8DCC8]">
                  {subscribers.map((sub) => (
                    <tr key={sub.id} className="hover:bg-[#FFFBF3]/30 transition-colors">
                      <td className="px-4 py-3 font-semibold text-gray-900">
                        <a href={`mailto:${sub.email}`} className="hover:underline flex items-center gap-1.5 text-[#4A1D1F]"><Mail className="h-3 w-3" /> {sub.email}</a>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs">
                        <div className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> {new Date(sub.createdAt).toLocaleDateString()}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <a href={`mailto:${sub.email}`} className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-[#FFFBF3] border border-[#E8DCC8] text-[#4A1D1F] hover:bg-[#4A1D1F] hover:text-white transition-colors" title="Send Email">
                          <Mail className="h-3.5 w-3.5" />
                        </a>
                      </td>
                    </tr>
                  ))}
                  {subscribers.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-[#646464]">
                        No newsletter subscribers found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
