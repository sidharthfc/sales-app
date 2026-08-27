import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Package } from 'lucide-react'
import EmptyState from './EmptyState'

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState icon={Package} title="No orders" description="Nothing pending today." />)
    expect(screen.getByText('No orders')).toBeInTheDocument()
    expect(screen.getByText('Nothing pending today.')).toBeInTheDocument()
  })

  it('omits the description when none is given', () => {
    render(<EmptyState title="No orders" />)
    expect(screen.getByText('No orders')).toBeInTheDocument()
    expect(screen.queryByText('Nothing pending today.')).not.toBeInTheDocument()
  })
})
