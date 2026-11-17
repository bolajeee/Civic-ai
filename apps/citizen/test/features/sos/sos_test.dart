import 'package:civic_report/features/sos/models/sos_models.dart';
import 'package:civic_report/features/sos/services/sos_text.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('normalizePhone', () {
    test('accepts every common Nigerian form', () {
      for (final input in [
        '08031234567',
        '0803 123 4567',
        '803-123-4567',
        '2348031234567',
        '+234 803 123 4567',
      ]) {
        expect(normalizePhone(input), '+2348031234567', reason: input);
      }
      expect(normalizePhone('+447911123456'), '+447911123456');
    });

    test('rejects implausible numbers', () {
      for (final input in ['', '12345', '0603123456', '+2340803123456', 'call me']) {
        expect(normalizePhone(input), isNull, reason: input);
      }
    });
  });

  group('SMS fallback', () {
    test('addresses one contact, Android style', () {
      final uri = smsUri('+2348055551234', 'Help me', ios: false);
      expect(uri.toString(), 'sms:+2348055551234?body=Help%20me');
    });

    test('addresses one contact, iOS style', () {
      final uri = smsUri('+2348055551234', 'Help me', ios: true);
      expect(uri.toString(), 'sms:+2348055551234&body=Help%20me');
    });

    test('a citizen without a full name is named from their email', () {
      expect(citizenDisplayName(' Ada Obi ', 'x@y.com'), 'Ada Obi');
      expect(citizenDisplayName(null, 'ibrahim.o_ibrahim@gmail.com'),
          'Ibrahim O Ibrahim');
      expect(citizenDisplayName('', 'bolajeee99@gmail.com'), 'Bolajeee');
      expect(citizenDisplayName(null, '123@x.com'), isNull);
      expect(citizenDisplayName(null, null), isNull);
    });

    test('offline text names the person, type and location', () {
      expect(
        offlineAlertText(
            name: 'Ada Obi', type: EmergencyType.accident, latitude: 6.6018, longitude: 3.3515),
        'SOS: Ada Obi needs help - ROAD ACCIDENT emergency. '
        'My location: https://maps.google.com/?q=6.60180,3.35150 '
        'Please call me or 112. (Sent via CivicAI)',
      );
      expect(offlineAlertText(name: null, type: EmergencyType.fire),
          startsWith('SOS: I need help - FIRE emergency. My location is not available.'));
    });

    test('offline text carries the live link when there is one', () {
      expect(
        offlineAlertText(
            name: 'Ada Obi', type: EmergencyType.medical,
            trackingUrl: 'https://civic.example/t/AbCdEfGhIjKlMnOpQrStUv'),
        endsWith('Please call me or 112. Follow my live location: '
            'https://civic.example/t/AbCdEfGhIjKlMnOpQrStUv (Sent via CivicAI)'),
      );
    });

    test('tel links keep only dialable characters', () {
      expect(telUri('0801 111-2222').toString(), 'tel:08011112222');
      expect(telUri('112').toString(), 'tel:112');
    });
  });

  group('models', () {
    test('distances read naturally', () {
      expect(formatDistance(42), '40 m');
      expect(formatDistance(140), '140 m');
      expect(formatDistance(2400), '2.4 km');
      expect(formatDistance(23600), '24 km');
    });

    test('a facility parses from /api/sos/nearby', () {
      final facility = EmergencyFacility.fromJson(const {
        'id': 'cur-1', 'name': 'NSCDC Lagos Command', 'kind': 'PARAMILITARY',
        'agency': 'NSCDC', 'address': null, 'phones': ['0800'],
        'latitude': 6.6, 'longitude': 3.35, 'distanceMeters': 1250.4, 'source': 'CURATED',
      });
      expect(facility.kindLabel, 'NSCDC');
      expect(facility.curated, isTrue);
      expect(facility.distanceMeters, 1250);
      expect(facility.distanceLabel, '1.3 km');
    });

    test('an alert parses, including whether it has a location', () {
      const alertJson = {
        'publicId': 'SOS-1000', 'type': 'SECURITY', 'status': 'ACTIVE',
        'latitude': 6.6, 'longitude': 3.35, 'updateIntervalMinutes': 15,
        'lastPingedAt': '2026-11-16T13:00:00.000Z', 'pingCount': 2,
        'updatesStoppedAt': null, 'createdAt': '2026-11-16T12:30:00.000Z',
      };
      final alert = SosAlert.fromJson(alertJson);
      expect(alert.type, EmergencyType.security);
      expect(alert.isActive, isTrue);
      expect(alert.hasLocation, isTrue);
      expect(alert.updatesStopped, isFalse);
      expect(alert.updateIntervalMinutes, 15);
      expect(alert.trackingUrl, isNull);
      expect(
        SosAlert.fromJson({...alertJson, 'trackingUrl': 'https://civic.example/t/x'}).trackingUrl,
        'https://civic.example/t/x',
      );
    });

    test('a contact round-trips through the offline cache', () {
      const contact = TrustedContact(id: 'tc-1', name: 'Chidi', phone: '+2348055551234');
      final restored = TrustedContact.fromJson(contact.toJson());
      expect(restored.phone, contact.phone);
      expect(restored.relationship, isNull);
    });
  });
}
