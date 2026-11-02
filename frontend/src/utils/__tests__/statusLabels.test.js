import { describe, expect, it } from 'vitest';
import { matchesStatusGroup, orderDisplayStatus, statusLabel } from '../statusLabels';

describe('orderDisplayStatus', () => {
  it('shows an order paid while it waits for stock as paid', () => {
    const order = { status: 'pending_approval', payments: [{ status: 'approved' }] };
    expect(orderDisplayStatus(order)).toBe('paid_awaiting_stock');
    expect(statusLabel(orderDisplayStatus(order))).toBe('Paid · awaiting stock');
    expect(matchesStatusGroup('paid', orderDisplayStatus(order))).toBe(true);
    expect(matchesStatusGroup('awaiting_approval', orderDisplayStatus(order))).toBe(false);
  });

  it('leaves an unpaid order, or one whose payment was cancelled, awaiting approval', () => {
    expect(orderDisplayStatus({ status: 'pending_approval', payments: [] })).toBe('pending_approval');
    expect(orderDisplayStatus({ status: 'pending_approval', payments: [{ status: 'cancelled' }] })).toBe('pending_approval');
    expect(orderDisplayStatus({ status: 'pending_approval' })).toBe('pending_approval');
  });

  it('leaves every other status as stored', () => {
    expect(orderDisplayStatus({ status: 'confirmed', payments: [{ status: 'approved' }] })).toBe('confirmed');
    expect(orderDisplayStatus({ status: 'cancelled', payments: [{ status: 'approved' }] })).toBe('cancelled');
  });
});

describe('payment status labels', () => {
  it('reads Paid and Cancelled, without the word "payment"', () => {
    expect(statusLabel('payment_approved')).toBe('Paid');
    expect(statusLabel('payment_cancelled')).toBe('Cancelled');
  });
});
