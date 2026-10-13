export interface Address {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface Customer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
}

export interface SavedCard {
  brand: string;
  last4: string;
}

export type OrderStatus = "pending" | "paid" | "shipped" | "cancelled";

export interface Order {
  id: string;
  customerId: string;
  status: OrderStatus;
  subtotalCents: number;
  taxCents: number;
  giftCardCents: number;
  totalCents: number;
  placedAt: string;
}
