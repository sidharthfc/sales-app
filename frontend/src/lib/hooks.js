import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import useAppStore from '@/store/useAppStore'
import { getCheckedInSelectedCustomer, getActiveCheckedInCustomer, toSelectedCustomer } from '@/lib/customerContext'

// ── useActiveCustomer ─────────────────────────────────────────────────────────
// Returns the currently checked-in customer. Used at the top of every page
// that requires an active customer (Invoices, Payments, Orders, Returns, etc.)
//
// Returns null if no customer is checked in.
export function useActiveCustomer() {
  const customers       = useAppStore(s => s.customers)
  const selectedCustomer = useAppStore(s => s.selectedCustomer)

  return useMemo(
    () =>
      getCheckedInSelectedCustomer(selectedCustomer, customers || []) ||
      toSelectedCustomer(getActiveCheckedInCustomer(customers || [])),
    // Depending on the whole object (not narrowed to .customer/.customer_name)
    // is deliberate: the compiler's memoization-preservation check reasons
    // about which identifiers the callback closes over, not which subfields
    // end up read, so a narrowed dep array risks silently going stale. The
    // computation itself is cheap, so there's nothing worth the tradeoff.
    [selectedCustomer, customers],
  )
}

// ── useSubmit ─────────────────────────────────────────────────────────────────
// Wraps an async action with submitting state + toast error handling.
// Eliminates the setSubmitting/try/catch/finally pattern repeated 5× across pages.
//
// Usage:
//   const [submitting, submit] = useSubmit()
//   <button onClick={() => submit(async () => { ... })}>
export function useSubmit() {
  const [submitting, setSubmitting] = useState(false)

  const submit = useCallback(async (action) => {
    if (submitting) return
    setSubmitting(true)
    try {
      return await action()
    } catch (err) {
      const msg = err?.message || 'Something went wrong.'
      toast.error(msg)
      throw err
    } finally {
      setSubmitting(false)
    }
  }, [submitting])

  return [submitting, submit]
}

// ── useAsync ──────────────────────────────────────────────────────────────────
// Manages loading/error state for a data-fetch function.
// Re-runs when any value in `deps` changes.
//
// Options (all optional):
//   enabled       - when false, skips the fetch entirely: `data` resets to
//                    null, `loading`/`error` reset to false/null. Use for
//                    "conditional fetch" pages (e.g. no checked-in customer
//                    yet). Whatever value(s) your `enabled` predicate reads
//                    must also be listed in `deps`, so a change re-runs.
//   errorMessage  - page-specific fallback shown via toast.error(err.message
//                    || errorMessage) on failure. Omit to fail silently (no
//                    toast) — matches the base hook's original behavior.
//   resetOnError  - when true, clears `data` back to null on a failed fetch
//                    (matches pages that blank their list on error) instead
//                    of leaving the last-successful data on screen.
//
// Usage:
//   const { data, loading, error, reload, setData } = useAsync(
//     () => api.get(endpoints.getInvoices, { params }),
//     [customer, statusFilter],
//     { enabled: !!customer, errorMessage: 'Failed to load invoices.', resetOnError: true },
//   )
export function useAsync(fn, deps = [], { enabled = true, errorMessage, resetOnError = false } = {}) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const counter = useRef(0)

  const run = useCallback(async () => {
    const id = ++counter.current

    if (!enabled) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const result = await fn()
      if (id === counter.current) setData(result)
    } catch (err) {
      if (id === counter.current) {
        const message = err?.message || errorMessage || 'Failed to load.'
        setError(message)
        if (errorMessage) toast.error(message)
        if (resetOnError) setData(null)
      }
    } finally {
      if (id === counter.current) setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => { run() }, [run])

  return { data, loading, error, reload: run, setData }
}

// ── useAmountInput ────────────────────────────────────────────────────────────
// Manages a numeric amount input with validation helpers.
// Used in payment collection and delivery modals.
//
// Usage:
//   const { amount, enteredAmount, setAmount, isOver, isPartial } =
//     useAmountInput(outstanding, mode)
export function useAmountInput(outstanding, mode) {
  const [amount, setAmount] = useState('0')
  const enteredAmount = parseFloat(amount) || 0
  const isCredit  = mode === 'Credit'
  const isOver    = !isCredit && enteredAmount > outstanding
  const isPartial = !isCredit && enteredAmount > 0 && enteredAmount < outstanding

  const reset = useCallback(() => setAmount('0'), [])

  return { amount, enteredAmount, setAmount, isOver, isPartial, reset }
}

// ── useGroupedByCustomer ──────────────────────────────────────────────────────
// Groups a flat rows array by `row.customer` into
// { customer, customer_name, total, items[] } records, summing `valueKey`
// per group. Used by route pages that show a per-customer rollup (overdue
// invoices, pending orders) over an otherwise flat list.
//
// Usage:
//   const { groups, total, count } = useGroupedByCustomer(rows, 'outstanding_amount')
export function useGroupedByCustomer(rows, valueKey) {
  return useMemo(() => {
    const map = {}
    for (const row of rows || []) {
      if (!map[row.customer]) {
        map[row.customer] = {
          customer: row.customer,
          customer_name: row.customer_name || row.customer,
          total: 0,
          items: [],
        }
      }
      map[row.customer].items.push(row)
      map[row.customer].total += row[valueKey] || 0
    }
    const groups = Object.values(map)
    const total = groups.reduce((s, g) => s + g.total, 0)
    const count = groups.reduce((s, g) => s + g.items.length, 0)
    return { groups, total, count }
  }, [rows, valueKey])
}

// ── useSearch ─────────────────────────────────────────────────────────────────
// Debounced search state. Returns the live value for the input and a debounced
// value suitable for API calls.
//
// Usage:
//   const { query, debouncedQuery, setQuery } = useSearch(300)
export function useSearch(delayMs = 300) {
  const [query,          setQuery]          = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), delayMs)
    return () => clearTimeout(timer)
  }, [query, delayMs])

  const reset = useCallback(() => { setQuery(''); setDebouncedQuery('') }, [])

  return { query, debouncedQuery, setQuery, reset }
}
