export default function AcceptableUsePage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 space-y-10">
      <h1 className="text-4xl font-bold">Acceptable Use Policy</h1>
      <p className="text-muted-foreground">
        Last updated: {new Date().toLocaleDateString()}
      </p>

      <section>
        <h2 className="text-xl font-semibold">1. Overview</h2>
        <p>
          This Acceptable Use Policy ("Policy") outlines the rules and
          guidelines for using the Louis.Ai platform. By using the Service,
          you agree not to misuse the platform or assist others in doing so.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">2. Illegal Activities</h2>
        <p>Users may not use Louis.Ai to:</p>
        <ul className="list-disc ml-6 space-y-2">
          <li>Engage in illegal activity</li>
          <li>Distribute unlawful, harmful, or fraudulent content</li>
          <li>Store or share content that violates local or international law</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">3. Intellectual Property</h2>
        <p>
          Users may not upload, distribute, or process content that infringes
          on copyrights, trademarks, or other intellectual property rights
          without proper authorization.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">4. Platform Abuse</h2>
        <p>Users may not attempt to:</p>
        <ul className="list-disc ml-6 space-y-2">
          <li>Reverse engineer or copy the Louis.Ai platform</li>
          <li>Exploit security vulnerabilities</li>
          <li>Access accounts or workspaces without authorization</li>
          <li>Disrupt the platform or its infrastructure</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">5. Automation and Scraping</h2>
        <p>
          Automated scraping, bulk extraction, or attempts to copy the
          platform’s data or functionality are prohibited unless explicitly
          authorized.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">6. Malware and Harmful Content</h2>
        <p>Users may not upload or distribute:</p>
        <ul className="list-disc ml-6 space-y-2">
          <li>Malware or viruses</li>
          <li>Malicious scripts</li>
          <li>Files intended to damage or disrupt systems</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">7. Responsible AI Usage</h2>
        <p>
          Louis.Ai provides AI-powered tools to assist with document analysis
          and knowledge retrieval. Users may not use the platform to generate
          harmful, deceptive, or illegal content.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">8. Enforcement</h2>
        <p>
          We may investigate violations of this Policy and take appropriate
          action, including suspending or terminating accounts that violate
          these rules.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">9. Changes to This Policy</h2>
        <p>
          Louis.Ai may update this Acceptable Use Policy periodically.
          Continued use of the Service indicates acceptance of the updated
          policy.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">10. Contact</h2>
        <p>If you have questions regarding this policy, contact:</p>
        <p className="font-medium">support@letsalterminds.org</p>
      </section>
    </div>
  );
}