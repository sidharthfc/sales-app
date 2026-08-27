import { ListSkeleton } from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'

// Handles the loading → error → empty → content rendering pattern.
// Eliminates the triple-conditional block repeated across all list pages.
//
// Usage:
//   <DataList
//     loading={loading}
//     error={error}
//     empty={items.length === 0}
//     emptyIcon={Receipt}
//     emptyTitle="No invoices"
//     emptyDescription="Check in a customer to see invoices."
//     skeletonCount={4}
//   >
//     {items.map(item => <ItemRow key={item.name} item={item} />)}
//   </DataList>
export default function DataList({
  loading,
  error,
  empty,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  skeletonCount = 4,
  children,
}) {
  if (loading) return <ListSkeleton count={skeletonCount} />

  if (error) {
    return (
      <div className="rounded-2xl bg-red-50 border border-red-100 px-4 py-4 text-sm text-red-600">
        {error}
      </div>
    )
  }

  if (empty) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
      />
    )
  }

  return <>{children}</>
}
