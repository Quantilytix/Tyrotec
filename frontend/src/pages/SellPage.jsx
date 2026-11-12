import { COMPANY } from '../utils/pdfShared';
import Card from '../components/ui/Card';

// "Sell on Tyrotec": a marketplace for other sellers is planned, not built.
// Until it is, this page says so and collects interest by email, so Tyrotec
// has a list of sellers ready when it launches. Open to everyone.
const INTEREST_EMAIL = `mailto:${COMPANY.email}?subject=${encodeURIComponent('Sell on Tyrotec: register my interest')}&body=${encodeURIComponent(
  'Hi Tyrotec,\n\nI would like to sell my products through Tyrotec.\n\nCompany name:\nContact person:\nPhone number:\nWhat we sell (types of parts or equipment):\nWebsite (if any):\n\nThank you.'
)}`;

const STEPS = [
  {
    title: 'Register your interest',
    text: 'Tell us who you are and what you sell. It takes a minute.',
  },
  {
    title: 'We get in touch',
    text: 'Our team contacts you to understand your products and how you supply them.',
  },
  {
    title: 'Sell to mining customers',
    text: "When selling on Tyrotec opens, you're among the first to list your products.",
  },
];

export default function SellPage() {
  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-xl font-semibold text-ink">Sell on Tyrotec</h1>
        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-600">Coming soon</span>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        We're opening Tyrotec to other suppliers: sell your mining spares, components and equipment to the customers who
        already buy from us, on the same portal.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <Card key={step.title} className="p-4">
            <p className="font-mono text-xs text-slate-400">0{i + 1}</p>
            <p className="mt-1 text-sm font-semibold text-ink">{step.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{step.text}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-ink">Interested in selling with us?</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Email {COMPANY.email} or call {COMPANY.phone}. We'll keep you posted.
          </p>
        </div>
        <a
          href={INTEREST_EMAIL}
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-teal-600"
        >
          Register my interest
        </a>
      </Card>
    </div>
  );
}
