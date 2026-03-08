export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 space-y-10">
      <h1 className="text-4xl font-bold">Privacy Policy</h1>
      <p className="text-muted-foreground">
        Last updated: {new Date().toLocaleDateString()}
      </p>

      <section>
        <h2 className="text-xl font-semibold">1. Introduction</h2>
        <p>
          Louis.Ai ("we", "our", or "the Service") respects your privacy and is
          committed to protecting the information you share with us. This
          Privacy Policy explains how we collect, use, and safeguard your data
          when you use the Louis.Ai platform.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">2. Information We Collect</h2>
        <p>We may collect the following types of information:</p>

        <ul className="list-disc ml-6 space-y-2">
          <li>Email address and account credentials</li>
          <li>Workspace and agency information</li>
          <li>Documents uploaded to the platform</li>
          <li>Usage data such as feature interactions and activity</li>
          <li>Billing information processed through Stripe</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">3. How We Use Information</h2>
        <p>We use collected information to:</p>

        <ul className="list-disc ml-6 space-y-2">
          <li>Provide and operate the Louis.Ai platform</li>
          <li>Enable AI-assisted document processing and knowledge retrieval</li>
          <li>Improve product reliability and performance</li>
          <li>Process payments and manage subscriptions</li>
          <li>Provide customer support</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">4. AI Processing</h2>
        <p>
          Documents and content uploaded to Louis.Ai may be processed by AI
          systems in order to generate summaries, responses, extractions, or
          workflow automations.
        </p>

        <p>
          AI systems may analyze uploaded content to provide features such as
          scheduling extraction, document search, and knowledge retrieval.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">5. Third-Party Services</h2>
        <p>Louis.Ai relies on trusted third-party providers to operate the service.</p>

        <ul className="list-disc ml-6 space-y-2">
          <li>Stripe for payment processing</li>
          <li>OpenAI for AI processing services</li>
          <li>Cloud infrastructure providers for hosting</li>
        </ul>

        <p>
          These providers may process limited data only as necessary to deliver
          their services.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">6. Data Ownership</h2>
        <p>
          Users retain ownership of the documents and data they upload to the
          platform.
        </p>

        <p>
          Louis.Ai does not sell user data and does not use uploaded documents
          for advertising purposes.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">7. Data Security</h2>
        <p>
          We implement reasonable technical and organizational safeguards to
          protect user data. However, no system can guarantee absolute
          security.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">8. Data Retention</h2>
        <p>
          We retain user data only as long as necessary to operate the platform
          and comply with legal obligations.
        </p>

        <p>
          Users may request deletion of their account and associated data
          through account settings or by contacting support.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">9. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Continued use of
          the Service after changes indicates acceptance of the updated policy.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">10. Contact</h2>
        <p>If you have questions about this Privacy Policy, contact:</p>
        <p className="font-medium">privacy@letsalterminds.org</p>
      </section>
    </div>
  );
}