export interface Order {
  id: string;
  customerId: string;
  status: string;
}

export interface RefundRequest {
  customerId: string;
  orderId: string;
  chargeId: string;
  amount: number;
  currency: string;
  daysFromDelivery: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
}
