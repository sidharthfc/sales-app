export function getActiveCheckedInCustomer(customers = []) {
  return customers.find((customer) => (
    customer?.visit_status === 'Visited' && !customer?.checkout_time
  )) || null
}

export function isCustomerCheckedIn(customers = [], customerId) {
  if (!customerId) return false
  return customers.some((customer) => (
    customer?.customer === customerId
    && customer?.visit_status === 'Visited'
    && !customer?.checkout_time
  ))
}

export function getCheckedInSelectedCustomer(selectedCustomer, customers = []) {
  if (!selectedCustomer?.customer) return null
  return isCustomerCheckedIn(customers, selectedCustomer.customer)
    ? toSelectedCustomer(selectedCustomer)
    : null
}

export function toSelectedCustomer(customer) {
  if (!customer?.customer) return null
  return {
    customer: customer.customer,
    customer_name: customer.customer_name || customer.customer,
  }
}
