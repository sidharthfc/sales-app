import { useEffect, useState, useMemo } from 'react'
import { Search, SlidersHorizontal, MapPin, Minus, Plus, X, CheckCircle, ShoppingCart, ClipboardList, CreditCard, Truck, ClipboardCheck } from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints, BASE_URL } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import PageHeader from '@/components/shared/PageHeader'
import { ListSkeleton } from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import { fmt2 } from '@/lib/format'
import { paymentModesWithCredit, defaultPaymentMode } from '@/lib/constants'
import { useActiveCustomer, useAsync, useSubmit } from '@/lib/hooks'

// ── Constants ────────────────────────────────────────────────────────────────

const PRICE_BANDS = [
  { key: 'All',   label: 'All Prices',  min: 0,    max: Infinity },
  { key: '<100',  label: 'Under ₹100',  min: 0,    max: 100      },
  { key: '100+',  label: '₹100–500',    min: 100,  max: 500      },
  { key: '500+',  label: '₹500–1000',   min: 500,  max: 1000     },
  { key: '1000+', label: '₹1000–5000',  min: 1000, max: 5000     },
  { key: '5000+', label: 'Above ₹5000', min: 5000, max: Infinity },
]

const SORT_OPTIONS = [
  { key: 'default',    label: 'Default'          },
  { key: 'name_asc',   label: 'Name A → Z'       },
  { key: 'price_asc',  label: 'Price Low → High' },
  { key: 'price_desc', label: 'Price High → Low' },
]

const DEFAULT_FILTERS = {
  material:    'All',
  priceRange:  'All',
  sort:        'default',
  inStockOnly: false,
}

// Deliver & Bill wins the default when both modes are enabled (today's
// behavior); when only one is enabled there's nothing to default away from.
const defaultSaleMode = (features) =>
  features.enable_deliver_bill ? 'deliver_bill' : 'order_only'

// ── Step indicator ────────────────────────────────────────────────────────────

function StepBar({ step }) {
  const steps = [
    { key: 'items',   icon: ShoppingCart,  label: 'Items'    },
    { key: 'cart',    icon: ClipboardList, label: 'Order'    },
    { key: 'payment', icon: CreditCard,    label: 'Payment'  },
  ]
  const idx = steps.findIndex(s => s.key === step)
  return (
    <div className="flex items-center px-6 py-2 bg-white border-b border-slate-100">
      {steps.map((s, i) => {
        const Icon    = s.icon
        const done    = i < idx
        const active  = i === idx
        return (
          <div key={s.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-0.5">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                done   ? 'bg-green-500'     :
                active ? 'bg-brand'    : 'bg-slate-200'
              }`}>
                <Icon className="w-3.5 h-3.5 text-white" />
              </div>
              <span className={`text-[10px] font-medium ${active ? 'text-brand' : done ? 'text-green-500' : 'text-slate-400'}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mb-3 rounded ${i < idx ? 'bg-green-400' : 'bg-slate-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Sales() {
  const session          = useAppStore(s => s.session)
  const features         = useAppStore(s => s.features)
  const paymentModesRaw  = useAppStore(s => s.paymentModes)
  const paymentModes     = paymentModesWithCredit(paymentModesRaw)
  const activeCustomer   = useActiveCustomer()

  const [customer,    setCustomer]    = useState(activeCustomer || null)
  const [step,        setStep]        = useState('items')   // items | cart | payment | success
  const [saleMode,    setSaleMode]    = useState(() => defaultSaleMode(features))  // deliver_bill | order_only
  const [prevSaleMode, setPrevSaleMode] = useState(saleMode)

  // Step 1 state
  const [search,      setSearch]      = useState('')
  const [filters,     setFilters]     = useState(DEFAULT_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [cart,        setCart]        = useState({})
  const [submitting,  submitCart]     = useSubmit()

  // Deliver & Bill and Take Order query completely different item catalogues
  // (van-stock-only with a van_qty cap, vs. the full catalogue with no cap) —
  // a cart built under one no longer means anything under the other, so it's
  // cleared on every mode switch. Adjusted during render (React's documented
  // pattern for "reset state when some other value changes"), not via an
  // effect, so there's no frame where the stale cart's total/count is shown
  // against the newly-fetched item list before the reset catches up.
  if (saleMode !== prevSaleMode) {
    setPrevSaleMode(saleMode)
    setCart({})
  }

  // Step 2 state (quotation)
  const [quotation,   setQuotation]   = useState(null)  // { quotation, grand_total, items }
  const [confirming,  submitConfirm]  = useSubmit()

  // Step 3 state (sales order)
  const [salesOrder,  setSalesOrder]  = useState(null)  // { sales_order, grand_total }
  const [payMode,     setPayMode]     = useState(() => defaultPaymentMode(paymentModes))
  const [paying,      submitPay]      = useSubmit()

  // Step 4 state (success)
  const [result,      setResult]      = useState(null)  // { invoice, grand_total, payment_recorded }

  // Pre-existing pattern; the react-compiler-derived lint rule below now completes analysis on
  // this component (it previously bailed out) after the submit handlers were simplified.
  // Behavior is unchanged; converting this to the render-phase adjustment idiom used in
  // Returns/Orders/Payments is a separate, out-of-scope change.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCustomer(activeCustomer || null)
  }, [activeCustomer])

  // ── Load items ──────────────────────────────────────────────────────────────
  const { data: itemsData, loading } = useAsync(
    () => {
      const params = { customer: customer.customer, page_length: 1000 }
      if (saleMode === 'deliver_bill' && session?.name) params.route_session = session.name
      return api.get(endpoints.getItems, { params })
    },
    [customer?.customer, saleMode, session?.name],
    { enabled: !!customer?.customer, errorMessage: 'Failed to load items.', resetOnError: true },
  )
  const items = useMemo(
    () => (Array.isArray(itemsData) ? itemsData : (itemsData?.items || [])),
    [itemsData],
  )

  // ── Derived materials list ──────────────────────────────────────────────────
  const materials = useMemo(() => {
    const set = new Set(items.map(i => i.specs?.material).filter(Boolean))
    return ['All', ...Array.from(set).sort()]
  }, [items])

  // ── Filtered & sorted items ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const band = PRICE_BANDS.find(b => b.key === filters.priceRange)

    let list = items.filter(item => {
      if (filters.material !== 'All' && item.specs?.material !== filters.material) return false
      if (band && band.key !== 'All') {
        const p = item.price || 0
        if (p < band.min || p >= band.max) return false
      }
      if (filters.inStockOnly && !item.in_stock) return false
      if (search) {
        const q = search.toLowerCase()
        if (!(item.item_name || '').toLowerCase().includes(q) &&
            !(item.item_code || '').toLowerCase().includes(q)) return false
      }
      return true
    })

    if (filters.sort === 'name_asc')   list = [...list].sort((a, b) => (a.item_name || '').localeCompare(b.item_name || ''))
    if (filters.sort === 'price_asc')  list = [...list].sort((a, b) => (a.price || 0) - (b.price || 0))
    if (filters.sort === 'price_desc') list = [...list].sort((a, b) => (b.price || 0) - (a.price || 0))

    return list
  }, [items, filters, search])

  const activeFilterCount = Object.entries(filters).filter(([k, v]) => v !== DEFAULT_FILTERS[k]).length

  const setQty = (code, qty) => setCart(prev => {
    if (qty <= 0) { const n = { ...prev }; delete n[code]; return n }
    return { ...prev, [code]: qty }
  })

  const totalItems  = Object.values(cart).reduce((s, q) => s + q, 0)
  const cartTotal   = Object.entries(cart).reduce((s, [code, qty]) => {
    const item = items.find(i => i.item_code === code)
    return s + (item?.price || 0) * qty
  }, 0)

  // ── Step 1 → 2: Create Quotation (or Order Only) ───────────────────────────
  const handleAddToCart = async () => {
    const cartItems = Object.entries(cart)
      .map(([item_code, qty]) => {
        const item = items.find(i => i.item_code === item_code)
        // Send null (not 0) when no price so backend falls back to price list
        return { item_code, qty, rate: item?.price ?? null }
      })
      .filter(i => i.qty > 0)

    if (!cartItems.length) { toast.error('No items in cart.'); return }

    try {
      await submitCart(async () => {
        const data = await api.post(endpoints.createQuotation, {
          customer:      customer.customer,
          items:         cartItems,
          route_session: session?.name || null,
        })
        setQuotation(data)
        setStep('cart')
      })
    } catch {
      // toasted in useSubmit
    }
  }

  // ── Step 2 → 3: Confirm → Sales Order ──────────────────────────────────────
  // Deliver & Bill always goes on to Payment (goods leave the van now, so
  // it's billed now too). Take Order stops at a submitted Sales Order by
  // default — billing happens on the delivery visit via the separate
  // Delivery Note flow (delivery.py / CustomerDetail's pending-orders
  // screen) — unless this client's settings say Take Order should bill
  // immediately too (features.take_order_bills_immediately).
  const deferTakeOrderBilling = saleMode === 'order_only' && !features.take_order_bills_immediately
  const handleConfirmOrder = async () => {
    try {
      await submitConfirm(async () => {
        const data = await api.post(endpoints.confirmOrder, { quotation: quotation.quotation })
        setSalesOrder(data)
        if (deferTakeOrderBilling) {
          setResult({ invoice: null, grand_total: data.grand_total, payment_recorded: false, order_only: true })
          setStep('success')
        } else {
          setStep('payment')
        }
      })
    } catch {
      // toasted in useSubmit
    }
  }

  // ── Step 3 → 4: Payment → Invoice ──────────────────────────────────────────
  const handlePay = async () => {
    try {
      await submitPay(async () => {
        const data = await api.post(endpoints.completePayment, {
          sales_order:      salesOrder.sales_order,
          mode_of_payment:  payMode,
        })
        setResult(data)
        setStep('success')
      })
    } catch {
      // toasted in useSubmit
    }
  }

  // ── Reset ───────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setStep('items')
    setCart({})
    setQuotation(null)
    setSalesOrder(null)
    setResult(null)
    setPayMode(defaultPaymentMode(paymentModes))
    setSaleMode(defaultSaleMode(features))
    setCustomer(activeCustomer || null)
  }

  if (!customer) {
    return (
      <div className="h-full overflow-y-auto bg-app-bg">
        <PageHeader title="Sales" />
        <div className="px-4 pt-8">
          <EmptyState
            icon={MapPin}
            title="Customer is not checked in"
            description="Selling is available only while you are actively checked in at that customer."
          />
        </div>
      </div>
    )
  }

  // ── Success screen ──────────────────────────────────────────────────────────
  if (step === 'success') {
    const isOrderOnly = result?.order_only
    return (
      <div className="h-full bg-app-bg flex flex-col">
        <PageHeader title={isOrderOnly ? 'Order Placed' : 'Order Complete'} />
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center ${isOrderOnly ? 'bg-orange-100' : 'bg-green-100'}`}>
            {isOrderOnly
              ? <ClipboardCheck className="w-10 h-10 text-brand-dark" />
              : <CheckCircle className="w-10 h-10 text-green-500" />
            }
          </div>
          <div className="text-center">
            <h2 className="text-xl font-bold text-slate-900">
              {isOrderOnly ? 'Order Confirmed!' : 'Payment Successful!'}
            </h2>
            <p className="text-slate-500 text-sm mt-1">{customer.customer_name}</p>
            {isOrderOnly && (
              <p className="text-xs text-brand-dark mt-2 bg-brand-50 rounded-lg px-3 py-1.5">
                Delivery will be arranged on the next visit.
              </p>
            )}
          </div>
          <div className="w-full bg-white rounded-2xl shadow-sm p-5 space-y-3">
            {!isOrderOnly && <Row label="Invoice" value={result?.invoice} mono />}
            <Row label="Sales Order" value={salesOrder?.sales_order} mono />
            {!isOrderOnly && <Row label="Quotation" value={quotation?.quotation} mono />}
            <div className="border-t border-slate-100 pt-3">
              <Row label="Grand Total" value={`₹ ${fmt2(result?.grand_total || 0)}`} bold />
              {!isOrderOnly && <Row label="Payment Mode" value={payMode} />}
              {!isOrderOnly && (
                result?.payment_recorded
                  ? <Row label="Status" value="Paid ✓" green />
                  : <Row label="Status" value="Invoice created — payment pending" />
              )}
              {isOrderOnly && <Row label="Status" value="Order placed — pending delivery" />}
            </div>
          </div>
          <button
            onClick={handleReset}
            className="w-full brand-gradient text-white font-bold py-3.5 rounded-2xl text-sm"
          >
            New Order
          </button>
        </div>
      </div>
    )
  }

  // ── Payment screen ──────────────────────────────────────────────────────────
  if (step === 'payment') {
    return (
      <div className="h-full bg-app-bg flex flex-col">
        <PageHeader title="Payment" onBack={() => setStep('cart')}>
          <p className="text-white/80 text-sm mt-1">{customer.customer_name}</p>
        </PageHeader>
        <StepBar step="payment" />

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ scrollbarWidth: 'none' }}>

          {/* Sales Order summary */}
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Order Summary</p>
            <p className="text-xs text-slate-400 mb-1">Sales Order</p>
            <p className="text-sm font-semibold text-slate-800 font-mono mb-3">{salesOrder?.sales_order}</p>
            {salesOrder?.items?.map(d => (
              <div key={d.item_code} className="flex items-start justify-between py-1.5 border-b border-slate-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-700 leading-tight">{d.item_name || d.item_code}</p>
                  <p className="text-[11px] text-slate-400">{d.qty} {d.uom} × ₹{fmt2(d.rate)}</p>
                </div>
                <p className="text-xs font-semibold text-slate-700 ml-2">₹{fmt2(d.amount)}</p>
              </div>
            ))}
            <div className="flex justify-between items-center pt-3 mt-1 border-t border-slate-100">
              <span className="text-sm font-bold text-slate-700">Grand Total</span>
              <span className="text-lg font-bold text-brand">₹ {fmt2(salesOrder?.grand_total || 0)}</span>
            </div>
          </div>

          {/* Payment mode */}
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Payment Mode</p>
            <div className="grid grid-cols-2 gap-2">
              {paymentModes.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setPayMode(key)}
                  className={`flex items-center gap-2 px-3 py-3 rounded-xl border-2 transition-colors ${
                    payMode === key
                      ? 'border-brand bg-brand/5'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <Icon className="w-5 h-5 text-slate-500" />
                  <span className={`text-sm font-semibold ${payMode === key ? 'text-brand' : 'text-slate-600'}`}>
                    {label}
                  </span>
                </button>
              ))}
            </div>
            {payMode === 'Credit' && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mt-3">
                Invoice will be created with outstanding amount. Payment to be collected later.
              </p>
            )}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex-shrink-0 bg-white border-t border-slate-100 px-4 py-3">
          <button
            onClick={handlePay}
            disabled={paying}
            className="w-full brand-gradient text-white font-bold py-3.5 rounded-2xl text-sm disabled:opacity-60"
          >
            {paying
              ? 'Processing…'
              : payMode === 'Credit'
                ? `Create Invoice — ₹ ${fmt2(salesOrder?.grand_total || 0)}`
                : `Confirm & Pay — ₹ ${fmt2(salesOrder?.grand_total || 0)}`
            }
          </button>
        </div>
      </div>
    )
  }

  // ── Cart / Quotation review screen ──────────────────────────────────────────
  if (step === 'cart') {
    return (
      <div className="h-full bg-app-bg flex flex-col">
        <PageHeader title="Order Review" onBack={() => setStep('items')}>
          <p className="text-white/80 text-sm mt-1">{customer.customer_name}</p>
        </PageHeader>
        <StepBar step="cart" />

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ scrollbarWidth: 'none' }}>

          {/* Quotation details */}
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Quotation</p>
              <span className="text-xs font-mono font-semibold text-brand bg-brand/10 px-2 py-0.5 rounded-full">
                {quotation?.quotation}
              </span>
            </div>
            {quotation?.items?.map(d => (
              <div key={d.item_code} className="flex items-start justify-between py-2 border-b border-slate-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 leading-tight">{d.item_name || d.item_code}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{d.qty} {d.uom} × ₹{fmt2(d.rate)}</p>
                </div>
                <p className="text-sm font-semibold text-slate-700 ml-2">₹{fmt2(d.amount)}</p>
              </div>
            ))}
            <div className="flex justify-between items-center pt-3 mt-2 border-t border-slate-100">
              <span className="font-bold text-slate-700">Grand Total</span>
              <span className="text-xl font-bold text-brand">₹ {fmt2(quotation?.grand_total || 0)}</span>
            </div>
          </div>

          <div className="bg-brand-50 border border-brand-100 rounded-2xl px-4 py-3">
            <p className="text-xs text-brand-dark font-medium">
              Review the quotation items. Tap "Place Order" to confirm and create a Sales Order.
            </p>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex-shrink-0 bg-white border-t border-slate-100 px-4 py-3 flex gap-3">
          <button
            onClick={() => setStep('items')}
            className="flex-1 border-2 border-slate-200 text-slate-600 font-semibold py-3 rounded-2xl text-sm"
          >
            Edit Items
          </button>
          <button
            onClick={handleConfirmOrder}
            disabled={confirming}
            className="flex-1 brand-gradient text-white font-bold py-3 rounded-2xl text-sm disabled:opacity-60"
          >
            {confirming ? 'Placing…' : 'Place Order →'}
          </button>
        </div>
      </div>
    )
  }

  // ── Item picker (step === 'items') ──────────────────────────────────────────
  return (
    <div className="h-full bg-app-bg flex flex-col">

      {/* Header */}
      <PageHeader title={customer.customer_name || customer.customer} onBack={() => setCustomer(null)}>
        <div className="mt-3 flex items-center justify-between text-white/80 text-xs">
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3" /> Delivery : Default billing address
          </span>
          <span className="font-medium">Type : Retailer</span>
        </div>
        <div className="mt-3 flex gap-2">
          <div className="flex-1 bg-white rounded-xl flex items-center px-3 gap-2">
            <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="search item name"
              className="flex-1 py-2.5 text-sm bg-transparent outline-none text-slate-700 placeholder-slate-400"
            />
            {search && (
              <button onClick={() => setSearch('')}><X className="w-3.5 h-3.5 text-slate-400" /></button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(true)}
            className="relative w-10 h-10 bg-white rounded-xl flex items-center justify-center flex-shrink-0"
          >
            <SlidersHorizontal className="w-4 h-4 text-slate-600" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-brand rounded-full text-white text-[10px] font-bold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </PageHeader>

      <StepBar step="items" />

      {/* Sale mode tabs — hidden entirely when only one mode is enabled;
          nothing to switch between */}
      {features.enable_deliver_bill && features.enable_take_order && (
        <div className="bg-white border-b border-slate-100 px-4 pt-2 pb-0 flex gap-2">
          <button
            onClick={() => setSaleMode('deliver_bill')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              saleMode === 'deliver_bill'
                ? 'border-brand text-brand'
                : 'border-transparent text-slate-500'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            Deliver & Bill
          </button>
          <button
            onClick={() => setSaleMode('order_only')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              saleMode === 'order_only'
                ? 'border-brand text-brand'
                : 'border-transparent text-slate-500'
            }`}
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            Take Order
          </button>
        </div>
      )}

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <div className="px-4 pt-2 flex gap-2 flex-wrap">
          {filters.material !== 'All' && (
            <Chip label={filters.material} onRemove={() => setFilters(f => ({ ...f, material: 'All' }))} />
          )}
          {filters.priceRange !== 'All' && (
            <Chip
              label={PRICE_BANDS.find(b => b.key === filters.priceRange)?.label}
              onRemove={() => setFilters(f => ({ ...f, priceRange: 'All' }))}
            />
          )}
          {filters.sort !== 'default' && (
            <Chip
              label={SORT_OPTIONS.find(s => s.key === filters.sort)?.label}
              onRemove={() => setFilters(f => ({ ...f, sort: 'default' }))}
            />
          )}
          {filters.inStockOnly && (
            <Chip label="In Stock" onRemove={() => setFilters(f => ({ ...f, inStockOnly: false }))} />
          )}
          <button
            onClick={() => setFilters(DEFAULT_FILTERS)}
            className="text-xs text-red-500 font-medium px-2 py-1"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Van mode banner + result count */}
      <div className="px-4 pt-2 pb-1 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">{filtered.length} items</p>
        {saleMode === 'deliver_bill' && session?.name && (
          <span className="text-[10px] font-semibold bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
            Van stock only
          </span>
        )}
      </div>

      {/* Item list */}
      <div className="flex-1 px-4 pb-3 space-y-3 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {loading ? (
          <ListSkeleton count={5} />
        ) : filtered.length === 0 ? (
          <p className="text-center text-slate-400 py-8 text-sm">No items found</p>
        ) : (
          filtered.map(item => (
            <ItemRow
              key={item.item_code}
              item={item}
              qty={cart[item.item_code] || 0}
              onQtyChange={q => setQty(item.item_code, q)}
            />
          ))
        )}
      </div>

      {/* Bottom bar */}
      <div className="flex-shrink-0 bg-white border-t border-slate-100 px-4 py-3 flex gap-3">
        <div className="flex-1 border-2 border-brand rounded-2xl flex flex-col items-center justify-center py-2">
          <span className="text-[10px] text-brand font-medium">Total</span>
          <span className="text-sm font-bold text-brand">{totalItems} items · ₹{fmt2(cartTotal)}</span>
        </div>
        <button
          onClick={handleAddToCart}
          disabled={totalItems === 0 || submitting}
          className="flex-1 brand-gradient text-white font-bold py-3 rounded-2xl text-sm disabled:opacity-60"
        >
          {submitting ? 'Creating…' : 'Add to Cart →'}
        </button>
      </div>

      {/* Filter bottom sheet */}
      {showFilters && (
        <FilterSheet
          filters={filters}
          materials={materials}
          onChange={setFilters}
          onClose={() => setShowFilters(false)}
        />
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Row({ label, value, mono, bold, green }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`text-xs ml-2 text-right max-w-[60%] truncate ${
        mono  ? 'font-mono font-semibold text-slate-700' :
        bold  ? 'font-bold text-slate-800' :
        green ? 'font-semibold text-green-600' : 'text-slate-600'
      }`}>{value}</span>
    </div>
  )
}

function Chip({ label, onRemove }) {
  return (
    <span className="flex items-center gap-1 bg-brand/10 text-brand text-xs font-medium px-2.5 py-1 rounded-full">
      {label}
      <button onClick={onRemove}><X className="w-3 h-3" /></button>
    </span>
  )
}

function ItemRow({ item, qty, onQtyChange }) {
  const maxQty = item.van_qty != null ? item.van_qty : Infinity
  const atMax  = qty >= maxQty

  return (
    <div className="bg-white rounded-2xl shadow-sm p-3 flex items-center gap-3">
      <div className="w-16 h-16 bg-slate-100 rounded-xl flex-shrink-0 overflow-hidden">
        {item.image
          ? <img src={BASE_URL + item.image} alt={item.item_name} className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-slate-200 rounded-xl" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-slate-800 font-semibold text-sm leading-tight">{item.item_name || item.item_code}</p>
        {item.specs?.material && (
          <p className="text-xs text-slate-400 mt-0.5">
            {item.specs.material}{item.specs.pipe_size ? ` · ${item.specs.pipe_size}` : ''}
          </p>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-brand font-bold text-sm">₹ {fmt2(item.price || 0)}</p>
          {item.van_qty != null && (
            <span className="text-[10px] font-semibold bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full">
              Van: {item.van_qty}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={() => onQtyChange(qty - 1)}
          className="w-7 h-7 border border-slate-200 rounded-lg flex items-center justify-center text-slate-600 active:bg-slate-100"
        >
          <Minus className="w-3 h-3" />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min="0"
          max={maxQty === Infinity ? undefined : maxQty}
          value={qty === 0 ? '' : qty}
          onChange={e => {
            const v = e.target.value
            if (v === '') { onQtyChange(0); return }
            const n = parseInt(v, 10)
            if (!isNaN(n) && n >= 0) onQtyChange(Math.min(n, maxQty))
          }}
          onBlur={e => { if (e.target.value === '') onQtyChange(0) }}
          placeholder="0"
          className="w-12 text-center text-sm font-semibold text-slate-700 border border-slate-200 rounded-lg py-1 outline-none focus:border-brand"
          style={{ MozAppearance: 'textfield' }}
        />
        <button
          onClick={() => !atMax && onQtyChange(qty + 1)}
          disabled={atMax}
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-opacity ${
            atMax ? 'bg-slate-200 opacity-40' : 'bg-brand active:opacity-80'
          }`}
        >
          <Plus className="w-3 h-3 text-white" />
        </button>
      </div>
    </div>
  )
}

function FilterSheet({ filters, materials, onChange, onClose }) {
  const [local, setLocal] = useState(filters)
  const set = (key, val) => setLocal(f => ({ ...f, [key]: val }))

  const apply = () => { onChange(local); onClose() }
  const reset = () => setLocal(DEFAULT_FILTERS)

  return (
    <div className="fixed inset-0 z-[100] flex items-end bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-[430px] mx-auto bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white pt-4 pb-3 px-5 border-b border-slate-100">
          <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-3" />
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900 text-base">Filters</h3>
            <button onClick={reset} className="text-sm text-brand font-medium">Reset</button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-6">
          <Section title="Sort By">
            <div className="grid grid-cols-2 gap-2">
              {SORT_OPTIONS.map(o => (
                <FilterPill key={o.key} label={o.label} active={local.sort === o.key} onClick={() => set('sort', o.key)} />
              ))}
            </div>
          </Section>

          <Section title="Price Range">
            <div className="grid grid-cols-3 gap-2">
              {PRICE_BANDS.map(b => (
                <FilterPill key={b.key} label={b.label} active={local.priceRange === b.key} onClick={() => set('priceRange', b.key)} />
              ))}
            </div>
          </Section>

          <Section title="Material">
            <div className="flex flex-wrap gap-2">
              {materials.map(m => (
                <FilterPill key={m} label={m} active={local.material === m} onClick={() => set('material', m)} />
              ))}
            </div>
          </Section>

          <Section title="Availability">
            <button
              onClick={() => set('inStockOnly', !local.inStockOnly)}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl border transition-colors ${
                local.inStockOnly ? 'border-brand bg-brand/5' : 'border-slate-200'
              }`}
            >
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                local.inStockOnly ? 'border-brand bg-brand' : 'border-slate-300'
              }`}>
                {local.inStockOnly && <div className="w-2 h-2 rounded-full bg-white" />}
              </div>
              <span className="text-sm font-medium text-slate-700">In Stock Only</span>
            </button>
          </Section>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-100 px-5 py-4 pb-safe">
          <button
            onClick={apply}
            className="w-full brand-gradient text-white font-bold py-3.5 rounded-2xl text-sm"
          >
            Apply Filters
          </button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">{title}</p>
      {children}
    </div>
  )
}

function FilterPill({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
        active
          ? 'bg-brand border-brand text-white'
          : 'bg-white border-slate-200 text-slate-600'
      }`}
    >
      {label}
    </button>
  )
}
