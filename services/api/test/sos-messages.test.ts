import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAlertSms,
  buildSafeSms,
  buildUpdateSms,
  buildUpdatesStoppedSms,
  displayName,
  distanceMeters,
  normalizePhone,
  SMS_MAX_LENGTH,
  toSmsText,
} from '../src/lib/sos-messages';

const sender = { name: 'Ada Obi', phone: '+2348031234567' };
const location = { latitude: 6.6018, longitude: 3.3515, accuracy: 12.4, address: '12 Allen Avenue, Ikeja, Lagos' };
const at = new Date('2026-11-16T13:05:00Z'); // 14:05 WAT
const gsmSafe = /^[\x20-\x7E]*$/;

test('normalizes Nigerian numbers in every common form to E.164', () => {
  for (const input of ['08031234567', '0803 123 4567', '803-123-4567', '2348031234567', '+234 803 123 4567', '(0803) 123-4567']) {
    assert.equal(normalizePhone(input), '+2348031234567', input);
  }
  assert.equal(normalizePhone('+447911123456'), '+447911123456');
});

test('rejects numbers that are not plausible', () => {
  for (const input of ['', '12345', '0603123456', '+2340803123456', '+23480312345', 'call me', '0803123456789']) {
    assert.equal(normalizePhone(input), null, input);
  }
});

test('distance is roughly right at Lagos latitudes', () => {
  const a = { lat: 6.6018, lon: 3.3515 };
  assert.ok(Math.abs(distanceMeters(a, { lat: 6.6063, lon: 3.3515 }) - 500) < 5);
  assert.equal(distanceMeters(a, a), 0);
});

test('free text is reduced to GSM-safe ASCII', () => {
  assert.equal(toSmsText('Àdá “Obi” – 🚑 help'), 'Ada "Obi" - help');
});

test('the alert SMS carries type, link, accuracy, time, callback and update cadence', () => {
  const sms = buildAlertSms({ sender, type: 'MEDICAL', location, note: 'Fell down the stairs', updateIntervalMinutes: 15, at });
  assert.match(sms, /^SOS from Ada Obi via CivicAI: MEDICAL emergency\./);
  assert.match(sms, /https:\/\/maps\.google\.com\/\?q=6\.60180,3\.35150/);
  assert.match(sms, /\(within 12 m\) at 14:05 WAT\./);
  assert.match(sms, /Call them: \+2348031234567\./);
  assert.match(sms, /Note: Fell down the stairs\./);
  assert.match(sms, /Updates every 15 min if they move\.$/);
  assert.ok(sms.length <= SMS_MAX_LENGTH);
  assert.match(sms, gsmSafe);
});

test('an alert without a location says so and promises no updates', () => {
  const sms = buildAlertSms({ sender: { name: null, phone: null }, type: 'ACCIDENT', location: null, updateIntervalMinutes: 30, at });
  assert.match(sms, /^SOS from A CivicAI user via CivicAI: ROAD ACCIDENT emergency\. Location: not available/);
  assert.doesNotMatch(sms, /maps\.google|Updates every|Call them/);
});

test('a citizen without a full name is named from their email', () => {
  assert.equal(displayName('  Ada Obi ', 'x@y.com'), 'Ada Obi');
  assert.equal(displayName(null, 'ibrahim.o_ibrahim@gmail.com'), 'Ibrahim O Ibrahim');
  assert.equal(displayName('', 'bolajeee99@gmail.com'), 'Bolajeee');
  assert.equal(displayName(null, '123@x.com'), null);
  assert.equal(displayName(null, null), null);
  const sms = buildAlertSms({
    sender: { name: displayName(null, 'ada.obi@example.com'), phone: null },
    type: 'MEDICAL', location: null, updateIntervalMinutes: 30, at,
  });
  assert.match(sms, /^SOS from Ada Obi via CivicAI/);
});

test('long notes and addresses are trimmed but the link and callback survive', () => {
  const sms = buildAlertSms({
    sender,
    type: 'SECURITY',
    location: { ...location, address: 'Block 14, '.repeat(30) },
    note: 'Two men followed me from the bus stop and are still outside the gate. '.repeat(4),
    updateIntervalMinutes: 30,
    at,
  });
  assert.ok(sms.length <= SMS_MAX_LENGTH, `length ${sms.length}`);
  assert.match(sms, /maps\.google\.com\/\?q=6\.60180,3\.35150/);
  assert.match(sms, /Call them: \+2348031234567/);
});

test('a tracking link replaces the update promise and survives trimming', () => {
  const trackingUrl = 'https://civic-ai-fq8e.onrender.com/t/AbCdEfGhIjKlMnOpQrStUv';
  const sms = buildAlertSms({
    sender: { name: 'Oluwaseun Adebayo-Okonkwo', phone: '+2348031234567' },
    type: 'ACCIDENT',
    location: { ...location, address: 'Block 14, '.repeat(30) },
    note: 'Two men followed me from the bus stop and are still outside the gate. '.repeat(4),
    updateIntervalMinutes: 15,
    trackingUrl,
    at,
  });
  assert.ok(sms.length <= SMS_MAX_LENGTH, `length ${sms.length}`);
  assert.ok(sms.endsWith(` Live location: ${trackingUrl}`), sms);
  assert.doesNotMatch(sms, /Updates every/);
  assert.match(sms, /maps\.google\.com\/\?q=6\.60180,3\.35150/);
  assert.match(sms, /Call them: \+2348031234567/);
  assert.match(sms, gsmSafe);
});

test('update, stopped and safe messages fit and stay ASCII', () => {
  for (const sms of [
    buildUpdateSms({ sender, location, at }),
    buildUpdatesStoppedSms(sender),
    buildSafeSms(sender),
  ]) {
    assert.ok(sms.length <= SMS_MAX_LENGTH);
    assert.match(sms, gsmSafe);
  }
  assert.match(buildUpdateSms({ sender, location, at }), /^Ada Obi SOS update \(14:05 WAT\): now at 12 Allen Avenue/);
});
