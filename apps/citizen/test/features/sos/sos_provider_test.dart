import 'package:civic_report/features/report/models/report_location.dart';
import 'package:civic_report/features/report/services/location_service.dart';
import 'package:civic_report/features/sos/models/sos_models.dart';
import 'package:civic_report/features/sos/providers/sos_provider.dart';
import 'package:civic_report/features/sos/services/sos_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:url_launcher_platform_interface/link.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

const trackingUrl = 'https://civic.example/t/AbCdEfGhIjKlMnOpQrStUv';
const contacts = [
  TrustedContact(id: 'tc-1', name: 'Chidi', phone: '+2348055551234'),
  TrustedContact(id: 'tc-2', name: 'Ngozi', phone: '+2348066661234'),
];

/// No location, so no position tracker (and no platform channel) starts.
SosAlert alert({String? link = trackingUrl, int interval = 30}) => SosAlert.fromJson({
      'publicId': 'SOS-1000', 'type': 'MEDICAL', 'status': 'ACTIVE',
      'latitude': null, 'longitude': null, 'updateIntervalMinutes': interval,
      'createdAt': '2026-11-16T09:00:00.000Z', 'trackingUrl': link,
    });

class FakeSosService implements SosService {
  bool smsEnabled = false;
  int safeCalls = 0;

  @override
  Future<SosAlert?> fetchActiveAlert() async => null;

  @override
  Future<RaiseAlertResult> raiseAlert({
    required String clientAlertId,
    required EmergencyType type,
    required int updateIntervalMinutes,
    double? latitude,
    double? longitude,
    double? accuracy,
    String? address,
  }) async =>
      RaiseAlertResult(
        alert: alert(),
        contactsQueued: smsEnabled ? contacts.length : 0,
        smsEnabled: smsEnabled,
        message: 'SOS from Ada Obi via CivicAI: MEDICAL emergency. Live location: $trackingUrl',
      );

  @override
  Future<MarkSafeResult> markSafe(String publicId) async {
    safeCalls++;
    return MarkSafeResult(
      alert: alert(),
      smsEnabled: smsEnabled,
      message: 'Ada Obi has marked themselves safe via CivicAI. No further SOS updates will be sent.',
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class NoGps implements LocationService {
  @override
  Future<ReportLocation> capture() async => throw StateError('no GPS in tests');

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class FakeUrlLauncher extends UrlLauncherPlatform {
  final List<String> launched = [];
  bool opens = true;

  @override
  LinkDelegate? get linkDelegate => null;

  @override
  Future<bool> canLaunch(String url) async => true;

  @override
  Future<bool> launchUrl(String url, LaunchOptions options) async {
    launched.add(url);
    return opens;
  }
}

String bodyOf(String smsUrl) =>
    Uri.decodeComponent(smsUrl.substring(smsUrl.indexOf('body=') + 5));

void main() {
  late FakeSosService service;
  late FakeUrlLauncher launcher;
  late SosProvider sos;

  setUp(() {
    service = FakeSosService();
    launcher = FakeUrlLauncher();
    UrlLauncherPlatform.instance = launcher;
    sos = SosProvider(service: service, locationService: NoGps())
      ..setCitizen('citizen-1', 'Ada Obi');
  });

  tearDown(() => sos.dispose());

  group('without server SMS', () {
    test('raising texts each contact on their own, never as a group', () async {
      await sos.raise(contacts);
      expect(sos.phase, SosPhase.active);
      expect(sos.smsEnabled, isFalse);

      // First contact only; the second waits until the citizen comes back.
      expect(launcher.launched.single, startsWith('sms:+2348055551234?body='));
      expect(bodyOf(launcher.launched.single), endsWith('Live location: $trackingUrl'));
      expect(sos.contactsMessaged, 1);
      expect(sos.nextTextContact?.name, 'Ngozi');
      expect(sos.nextTextNumber, 2);
      expect(sos.notice, contains('for Chidi. Tap Send (1 of 2), then come back here to text Ngozi.'));

      sos.onAppResumed();
      await pumpEventQueue();
      expect(launcher.launched, hasLength(2));
      expect(launcher.launched.last, startsWith('sms:+2348066661234?body='));
      expect(bodyOf(launcher.launched.last), bodyOf(launcher.launched.first));
      expect(sos.contactsMessaged, 2);
      expect(sos.nextTextContact, isNull);
      expect(sos.notice, endsWith('for Ngozi. Tap Send (2 of 2), then call 112.'));

      // Nothing left: further resumes open nothing.
      sos.onAppResumed();
      await pumpEventQueue();
      expect(launcher.launched, hasLength(2));
    });

    test('the next contact can be texted with a tap', () async {
      await sos.raise(contacts);
      expect(await sos.textNext(), isTrue);
      expect(launcher.launched.last, startsWith('sms:+2348066661234'));
      expect(await sos.textNext(), isFalse);
    });

    test('resending texts everyone again, one by one', () async {
      await sos.raise(contacts);
      await sos.textNext();
      await sos.resendLink(contacts);
      expect(launcher.launched, hasLength(3));
      expect(launcher.launched.last, launcher.launched.first);
      expect(sos.nextTextContact?.name, 'Ngozi');
    });

    test('a messages app that will not open is reported, not counted', () async {
      launcher.opens = false;
      await sos.raise(contacts);
      expect(sos.phase, SosPhase.active);
      expect(sos.contactsMessaged, 0);
      expect(sos.error, 'Could not open your messages app. Call 112.');
      // The contact stays first in line for a retry.
      expect(sos.nextTextContact?.name, 'Chidi');
    });

    test("marking safe texts each contact an I'm-safe text", () async {
      await sos.raise(contacts);
      await sos.markSafe(contacts);
      expect(service.safeCalls, 1);
      expect(sos.phase, SosPhase.idle);
      expect(sos.alert, isNull);
      expect(launcher.launched.last, startsWith('sms:+2348055551234?body='));
      expect(bodyOf(launcher.launched.last), startsWith('Ada Obi has marked themselves safe'));
      expect(sos.notice,
          "You're marked safe. Tap Send to tell Chidi (1 of 2), then come back here to text Ngozi.");
      sos.onAppResumed();
      await pumpEventQueue();
      expect(launcher.launched.last, startsWith('sms:+2348066661234?body='));
      expect(sos.notice, "You're marked safe. Tap Send to tell Ngozi (2 of 2).");
    });

    test('a single contact gets no count', () async {
      await sos.raise(contacts.take(1).toList());
      expect(sos.notice,
          'Your messages app opened with your alert and a live location link '
          'for Chidi. Tap Send, then call 112.');
    });

    test('marking safe with no contacts opens nothing', () async {
      await sos.raise(const []);
      expect(launcher.launched, isEmpty);
      await sos.markSafe(const []);
      expect(launcher.launched, isEmpty);
      expect(sos.notice, "You're marked safe.");
    });
  });

  group('with server SMS', () {
    setUp(() => service.smsEnabled = true);

    test('raising and marking safe never open the messages app', () async {
      await sos.raise(contacts);
      expect(sos.contactsQueued, 2);
      await sos.markSafe(contacts);
      expect(launcher.launched, isEmpty);
      expect(sos.notice, "You're marked safe. Your contacts have been told.");
    });
  });

  test('with a live link the phone reports every minute, otherwise per SMS interval', () {
    expect(SosProvider.reportIntervalFor(alert()), const Duration(minutes: 1));
    expect(SosProvider.reportIntervalFor(alert(link: null, interval: 15)),
        const Duration(minutes: 15));
  });
}
