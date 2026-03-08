export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 space-y-10">
      <h1 className="text-4xl font-bold">Terms of Service</h1>
      <p className="text-muted-foreground">
        Last updated: {new Date().toLocaleDateString()}
      </p>

      <section>
        <h2 className="text-xl font-semibold">1. Acceptance of Terms</h2>
        <p>
          By accessing or using Louis.Ai ("the Service"), you agree to be bound
          by these Terms of Service. If you do not agree to these terms, you may
          not use the Service.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">2. Description of Service</h2>
        <p>
          Louis.Ai is a software platform that provides AI-assisted knowledge
          retrieval, document analysis, workflow automation, scheduling
          extraction, and collaboration tools for organizations and teams.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">3. AI Disclaimer</h2>
        <p>
          Louis.Ai uses artificial intelligence systems to generate responses,
          analyze documents, and assist with workflows. AI-generated outputs may
          contain inaccuracies, incomplete information, or unintended results.
        </p>
        <p>
          Users are responsible for verifying AI-generated outputs before
          relying on them for business, financial, operational, or legal
          decisions.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">4. AI Output Responsibility</h2>
        <p>
          The Service provides AI-assisted responses and automated extraction of
          information from uploaded documents. These outputs are generated
          automatically and may not always be accurate.
        </p>
        <p>
          Users are solely responsible for reviewing and validating all outputs
          before relying on them. Louis.Ai is not responsible for decisions made
          based on AI-generated responses or extracted information.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">5. User Uploaded Content</h2>
        <p>
          Users may upload documents or data to the platform. By uploading
          content, you confirm that you have the legal right to use and process
          that material.
        </p>
        <p>
          Users are solely responsible for ensuring uploaded documents do not
          violate copyright laws, privacy regulations, or other legal
          obligations.
        </p>
        <p>
          Louis.Ai does not review or verify the legality of uploaded content.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">6. Agency Workspaces</h2>
        <p>
          Louis.Ai allows organizations ("agencies") to create shared
          workspaces. Workspace owners are responsible for managing members and
          ensuring compliance with these Terms.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">7. Payments and Billing</h2>
        <p>
          Paid plans are billed through Stripe. Subscriptions renew
          automatically unless canceled through the billing portal.
        </p>
        <p>
          Prices may change with notice. Canceling a subscription prevents
          future billing but does not refund the current billing period unless
          required by law.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">8. Service Availability</h2>
        <p>
          Louis.Ai is provided on an "as available" basis. While we strive for
          reliable uptime, we do not guarantee uninterrupted or error-free
          operation of the Service.
        </p>
        <p>
          Maintenance, infrastructure issues, or third-party service outages may
          temporarily affect platform availability.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">9. Data Storage and Loss</h2>
        <p>
          While Louis.Ai takes reasonable steps to protect stored data, users
          are responsible for maintaining their own backups of critical
          information.
        </p>
        <p>
          Louis.Ai is not liable for loss of uploaded documents, extracted data,
          or workspace information.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">10. Termination</h2>
        <p>
          We may suspend or terminate accounts that violate these Terms or
          abuse the platform.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">11. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, Louis.Ai shall not be liable
          for indirect, incidental, or consequential damages arising from the
          use of the Service.
        </p>
        <p>
          Louis.Ai's total liability arising from use of the Service shall not
          exceed the amount paid by the user to Louis.Ai during the previous 12
          months.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">12. Changes to Terms</h2>
        <p>
          We may update these Terms periodically. Continued use of the Service
          constitutes acceptance of the updated Terms.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">13. Contact</h2>
        <p>For questions regarding these Terms, contact:</p>
        <p className="font-medium">support@letsalterminds.org</p>
      </section>
    </div>
  );
}