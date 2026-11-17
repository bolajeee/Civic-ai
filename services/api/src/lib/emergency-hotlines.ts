/**
 * National emergency hotlines shown on the SOS screen.
 *
 * Every entry must be checked against the agency's official source before it
 * is added, and carry that source. A wrong number on an emergency screen is
 * worse than a missing one, so candidates that have not been verified yet are
 * tracked in docs/sos.md rather than listed here.
 */
export interface Hotline {
  id: string;
  label: string;
  number: string;
  description: string;
  sourceUrl: string;
}

export const EMERGENCY_HOTLINES: readonly Hotline[] = [
  {
    id: 'ng-112',
    label: 'National Emergency',
    number: '112',
    description: 'Toll-free from any network. Routes to police, fire and ambulance services.',
    sourceUrl: 'https://www.ncc.gov.ng/',
  },
];
