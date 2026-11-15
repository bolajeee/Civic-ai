import { LogoMark } from './Logo';

type LegalKind = 'terms' | 'privacy';

// DRAFT CONTENT: replace with text approved by the agency's legal and data-protection teams before launch.
const documents: Record<LegalKind, { title: string; updated: string; sections: { heading: string; body: string[] }[] }> = {
  terms: {
    title: 'Terms of Use',
    updated: 'Draft, pending legal review',
    sections: [
      { heading: 'Who may use this workspace', body: [
        'The CivicAI government workspace is for active operator and administrator accounts issued by your agency. Access is by invitation only.',
        'You must not share your credentials or let anyone else use your account.',
      ] },
      { heading: 'Acceptable use', body: [
        'Use citizen reports, locations and attachments only for official duties such as triage, review and service delivery.',
        'Do not copy, export or disclose report data outside agency-approved channels.',
      ] },
      { heading: 'Monitoring and accountability', body: [
        'Sign-ins and actions taken in this workspace, such as reviewing or resolving reports, are logged for audit and security purposes.',
        'Misuse may lead to suspension of your account and referral under agency policy.',
      ] },
      { heading: 'Changes and contact', body: [
        'These terms may be updated. Continued use after an update means you accept the revised terms.',
        'Questions go to your workspace administrator.',
      ] },
    ],
  },
  privacy: {
    title: 'Privacy Notice',
    updated: 'Draft, pending legal review',
    sections: [
      { heading: 'What we collect about you', body: [
        'Your work email address, your National Identification Number (NIN) provided at registration, your role, and records of your sign-ins and actions in the workspace.',
      ] },
      { heading: 'Why we collect it', body: [
        'To verify that you are an authorised government user, to secure the workspace, and to keep an audit trail of decisions made on citizen reports.',
      ] },
      { heading: 'Citizen report data', body: [
        'You will see information submitted by citizens, including descriptions, photos and locations. Handle it as confidential and use it only for the purpose it was submitted for.',
      ] },
      { heading: 'Sharing and retention', body: [
        'Account and audit data is available only to authorised administrators and is kept for the period set by agency policy and applicable Nigerian data protection law.',
      ] },
      { heading: 'Your rights', body: [
        'You may ask your administrator to access or correct your account information. Contact your agency data protection officer for other requests.',
      ] },
    ],
  },
};

export function LegalPage({ kind, signedIn }: { kind: LegalKind; signedIn: boolean }) {
  const doc = documents[kind];
  const other: LegalKind = kind === 'terms' ? 'privacy' : 'terms';
  return <main className="legal-page">
    <header className="legal-header">
      <a className="brand" href={signedIn ? '#overview' : '#'}><LogoMark />CivicAI</a>
      <a className="text-link" href={signedIn ? '#overview' : '#'}>{signedIn ? 'Back to workspace' : 'Back to sign in'}</a>
    </header>
    <article className="legal-card">
      <p className="eyebrow">LEGAL</p>
      <h1>{doc.title}</h1>
      <p className="legal-status" role="note">{doc.updated}. This text is a placeholder and is not yet in force.</p>
      {doc.sections.map(section => <section key={section.heading}>
        <h2>{section.heading}</h2>
        {section.body.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      </section>)}
      <p className="legal-switch"><a className="text-link" href={`#${other}`}>{other === 'terms' ? 'Read the Terms of Use' : 'Read the Privacy Notice'}</a></p>
    </article>
  </main>;
}

export function LegalLinks() {
  return <nav className="legal-links" aria-label="Legal"><a href="#terms">Terms of Use</a><span aria-hidden="true">·</span><a href="#privacy">Privacy Notice</a></nav>;
}
