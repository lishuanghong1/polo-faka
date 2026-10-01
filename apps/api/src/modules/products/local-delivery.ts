/** Only delivery methods fulfilled by this application remain available for sale. */
export const LOCAL_DELIVERY_TYPES = ['CARD_KEY', 'POOL_QUOTA', 'MANUAL'] as const;

export function isLocalDeliveryType(deliveryType: unknown): boolean {
  return LOCAL_DELIVERY_TYPES.some((type) => type === deliveryType);
}
