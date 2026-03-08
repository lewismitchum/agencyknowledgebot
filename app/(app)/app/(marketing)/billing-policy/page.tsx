export default function BillingPolicyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 space-y-10">
      <h1 className="text-4xl font-bold">Billing & Refund Policy</h1>
      <p className="text-muted-foreground">
        Last updated: {new Date().toLocaleDateString()}
      </p>

      <section>
        <h2 className="text-xl font-semibold">1. Subscription Billing</h2>
        <p>
          Louis.Ai offers subscription-based plans for access to premium
          features. Subscriptions are billed on a recurring monthly or annual
          basis depending on the selected plan.
        </p>
        <p>
          By subscribing to a paid plan, you authorize Louis.Ai to charge your
          payment method through our payment provider (Stripe) at the start of
          each billing cycle.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">2. Automatic Renewal</h2>
        <p>
          Subscriptions renew automatically at the end of each billing cycle
          unless canceled before the renewal date.
        </p>
        <p>
          Renewal charges will occur using the payment method associated with
          your account unless you update or cancel your subscription beforehand.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">3. Free Trials</h2>
        <p>
          Some plans may include a free trial period. If a trial is offered, the
          subscription will automatically convert to a paid plan when the trial
          ends unless canceled before the trial expiration.
        </p>
        <p>
          Free trials may be limited to one per workspace or organization.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">4. Cancellation</h2>
        <p>
          Users may cancel their subscription at any time through the billing
          management portal provided within the Louis.Ai platform.
        </p>
        <p>
          When a subscription is canceled, the service will remain active until
          the end of the current billing period.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">5. Refund Policy</h2>
        <p>
          Payments for subscriptions are generally non-refundable. Canceling a
          subscription prevents future billing but does not refund the current
          billing period except where required by law.
        </p>
        <p>
          In rare circumstances, Louis.Ai may issue refunds at its sole
          discretion.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">6. Failed Payments</h2>
        <p>
          If a payment fails or cannot be processed, Louis.Ai may suspend or
          restrict access to paid features until the payment issue is resolved.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">7. Pricing Changes</h2>
        <p>
          Louis.Ai reserves the right to modify pricing for future billing
          periods. Any pricing changes will be communicated in advance.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">8. Contact</h2>
        <p>If you have questions about billing or refunds, contact:</p>
        <p className="font-medium">support@letsalterminds.org</p>
      </section>
    </div>
  );
}