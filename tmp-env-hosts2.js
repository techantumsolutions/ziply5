const fs = require("fs")
const lines = fs.readFileSync(".env", "utf8").split(/\r?\n/)
lines.forEach((line, idx) => {
  const t = line.trim()
  if (!/DATABASE_URL|DIRECT_URL|SUPABASE_URL|NEXT_PUBLIC_SUPABASE/i.test(t)) return
  let host = "?"
  try {
    const v = t
      .replace(/^#\s*/, "")
      .slice(t.replace(/^#\s*/, "").indexOf("=") + 1)
      .trim()
      .replace(/^["']|["']$/g, "")
    const u = new URL(
      v.replace(/^postgresql:/i, "http:").replace(/^postgres:/i, "http:"),
    )
    host = u.hostname + ":" + (u.port || "default")
  } catch {}
  console.log(`${idx + 1}: ${t.startsWith("#") ? "#" : ""}${t.replace(/^#\s*/, "").split("=")[0]}=${host}`)
})
