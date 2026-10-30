import { money } from '../api.js';

const STAGE = {
  DISCOVERY: ['Gathering details', 'bg-paper text-ink/70'],
  AWAITING_CONFIRMATION: ['Waiting for your “yes”', 'bg-amber-soft text-amber'],
  BOOKING: ['Booking in progress', 'bg-amber-soft text-amber'],
  BOOKED: ['Booked', 'bg-sea-soft text-sea'],
};

export default function PriceBreakdown({ quote, stage, booking }) {
  const [label, cls] = STAGE[stage] || STAGE.DISCOVERY;
  return (
    <section className="bg-white border border-rule rounded-lg p-4" aria-label="Price breakdown">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">{stage === 'BOOKED' ? 'Booking confirmation' : 'Price breakdown'}</h2>
        <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
      </div>

      {stage === 'BOOKED' && booking ? (
        <dl className="text-sm space-y-1.5">
          <Row k="Reference" v={<span className="font-mono">{booking.bookingRef}</span>} />
          <Row k="Package" v={booking.productName} />
          <Row k="Plan" v={booking.planCode} />
          <Row k="Quantity" v={booking.quantity} />
          <Row k="Discount" v={booking.promoCode ? `${booking.discountPercent}% (${booking.promoCode})` : 'None'} />
          <div className="border-t border-rule pt-2 mt-2"><Row k="Total charged" v={<b className="text-base">{money(booking.finalPrice)}</b>} /></div>
        </dl>
      ) : quote ? (
        <dl className="text-sm space-y-1.5">
          <Row k="Package" v={quote.name} />
          <Row k="Plan" v={quote.plan} />
          <Row k="Quantity" v={`${quote.quantity} × ${money(quote.unitPrice)}`} />
          {quote.requirement != null && <Row k="Coverage" v={`${quote.requirement} needed → up to ${quote.coverage}`} />}
          <Row k="Subtotal" v={money(quote.subtotal)} />
          <Row k="Discount" v={quote.discountPercent ? <span className="text-amber font-medium">{quote.discountPercent}% · {quote.promoCode} (−{money(quote.discountAmount)})</span> : 'None'} />
          <div className="border-t border-rule pt-2 mt-2"><Row k="Total" v={<b className="text-base">{money(quote.total)}</b>} /></div>
        </dl>
      ) : (
        <p className="text-sm text-ink/60">No quote yet. Tell the agent what you need and the exact quantity and price appear here.</p>
      )}
    </section>
  );
}

const Row = ({ k, v }) => (
  <div className="flex justify-between gap-4"><dt className="text-ink/60">{k}</dt><dd className="text-right">{v}</dd></div>
);
