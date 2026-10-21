import type { ReactNode } from "react"

export function ConsoleTable({
  headers,
  children,
  headerClassNames,
}: {
  headers: string[]
  children: ReactNode
  headerClassNames?: Record<number, string>
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#E8DCC8] bg-white shadow-sm">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="bg-[#4A1D1F] text-[11px] font-semibold uppercase tracking-wide text-[#F5F1E6]">
          <tr>
            {headers.map((h, idx) => (
              <th
                key={`${h || "col"}-${idx}`}
                className={`px-3 py-2.5 md:px-4 ${headerClassNames?.[idx] ?? ""}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E8DCC8] text-[#333]">{children}</tbody>
      </table>
    </div>
  )
}

export function ConsoleTd({
  children,
  className = "",
  colSpan,
}: {
  children: ReactNode
  className?: string
  colSpan?: number
}) {
  return (
    <td colSpan={colSpan} className={`px-3 py-2 align-center text-[13px] md:px-4 ${className}`}>
      {children}
    </td>
  )
}
