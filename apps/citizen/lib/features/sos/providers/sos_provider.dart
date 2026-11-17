import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/security/app_lock.dart';
import '../../report/models/report_location.dart';
import '../../report/services/location_service.dart';
import '../../report/services/offline_report_queue.dart'
    show createClientSubmissionId;
import '../models/sos_models.dart';
import '../services/sos_location_tracker.dart';
import '../services/sos_service.dart';
import '../services/sos_text.dart';

enum SosPhase { idle, sending, active }

/// State for the SOS screen: the citizen's position, help nearby for the
/// chosen emergency type, and the alert lifecycle (raise, location updates,
/// safe).
class SosProvider extends ChangeNotifier {
  SosProvider({SosService? service, LocationService? locationService})
      : _service = service ?? SosService.instance,
        _locationService = locationService ?? LocationService.instance;

  final SosService _service;
  final LocationService _locationService;

  static const locationTimeout = Duration(seconds: 8);

  /// How often the phone reports its position while contacts can watch the
  /// live tracking page. The server still decides separately when (if ever)
  /// an update SMS goes out, using the alert's 15/30-minute interval.
  static const liveReportInterval = Duration(minutes: 1);

  String? _citizenId;
  String? _citizenName;

  // --- Choices ---------------------------------------------------------------
  EmergencyType _type = EmergencyType.medical;
  int _intervalMinutes = 30;

  // --- Location and help nearby ---------------------------------------------
  ReportLocation? _here;
  bool _isLocating = false;
  String? _locationMessage;
  NearbyHelp? _nearby;
  bool _isLoadingNearby = false;
  String? _nearbyError;
  int _nearbyRequest = 0;

  // --- Alert -----------------------------------------------------------------
  SosPhase _phase = SosPhase.idle;
  SosAlert? _alert;
  int _contactsQueued = 0;
  bool? _smsEnabled;
  String? _alertMessage;
  int _contactsMessaged = 0;
  String? _notice;
  String? _error;

  // --- Texting contacts from the phone --------------------------------------
  // One text per contact, opened one after another: a single text to several
  // people becomes a group MMS, which often fails to send.
  List<TrustedContact> _textQueue = const [];
  String? _textBody;
  int _textTotal = 0;
  bool _textingSafe = false;
  bool _textingOffline = false;
  bool _openingText = false;

  // --- Location updates ------------------------------------------------------
  SosLocationTracker? _tracker;
  DateTime? _lastSentAt;
  DateTime? _nextUpdateAfter;
  bool _updatesEnded = false;

  EmergencyType get type => _type;
  int get intervalMinutes => _intervalMinutes;
  ReportLocation? get here => _here;
  bool get isLocating => _isLocating;
  String? get locationMessage => _locationMessage;
  NearbyHelp? get nearby => _nearby;
  bool get isLoadingNearby => _isLoadingNearby;
  String? get nearbyError => _nearbyError;
  SosPhase get phase => _phase;
  SosAlert? get alert => _alert;
  int get contactsQueued => _contactsQueued;

  /// Whether the server texted contacts for this alert; null when unknown
  /// (an alert restored after the app restarted).
  bool? get smsEnabled => _smsEnabled;

  /// Contacts the phone's messages app was opened for (when the server does
  /// not send SMS). The citizen still had to tap Send.
  int get contactsMessaged => _contactsMessaged;
  String? get notice => _notice;
  String? get error => _error;
  bool get isSharingLocation => _tracker != null;
  DateTime? get lastSentAt => _lastSentAt;
  DateTime? get nextUpdateAfter => _nextUpdateAfter;
  bool get updatesEnded => _updatesEnded;

  /// The contact whose text opens next, while the phone is texting contacts
  /// one by one; null when there is no one left.
  TrustedContact? get nextTextContact =>
      _textQueue.isEmpty ? null : _textQueue.first;

  /// Position (1-based) of [nextTextContact] in the current run, and its size.
  int get nextTextNumber => _textTotal - _textQueue.length + 1;
  int get textTotal => _textTotal;

  /// Whether the run in progress is the "I'm safe" text.
  bool get textingSafe => _textingSafe;

  void setCitizen(String? id, String? name) {
    _citizenName = name;
    if (_citizenId == id) return;
    _citizenId = id;
    unawaited(_stopTracker());
    _phase = SosPhase.idle;
    _clearAlert();
    _clearTexts();
    _here = null;
    _nearby = null;
    _notice = null;
    _error = null;
    notifyListeners();
  }

  void _clearAlert() {
    _alert = null;
    _smsEnabled = null;
    _alertMessage = null;
    _contactsMessaged = 0;
  }

  /// Called when the SOS screen opens: restores an alert still running from
  /// earlier, then finds the citizen and the help around them.
  Future<void> open() async {
    _error = null;
    _notice = null;
    if (_phase != SosPhase.active) {
      try {
        final active = await _service.fetchActiveAlert();
        if (active != null) _becomeActive(active, contactsQueued: null);
      } on SosException {
        // Offline: the screen still works for calling and nearby help.
      }
    }
    notifyListeners();
    await locate();
  }

  Future<void> locate() async {
    if (_isLocating) return;
    _isLocating = true;
    _locationMessage = null;
    notifyListeners();
    try {
      _here = await _locationService.capture().timeout(locationTimeout);
    } on LocationException catch (e) {
      _locationMessage = e.failure.message;
    } on TimeoutException {
      _locationMessage =
          'Could not get a GPS fix. Move near a window or outside and try again.';
    } catch (_) {
      _locationMessage = 'Your location is unavailable right now.';
    } finally {
      _isLocating = false;
      notifyListeners();
    }
    if (_here != null) await loadNearby();
  }

  void selectType(EmergencyType value) {
    if (_type == value) return;
    _type = value;
    _nearby = null;
    notifyListeners();
    if (_here != null) unawaited(loadNearby());
  }

  void setInterval(int minutes) {
    if (_intervalMinutes == minutes) return;
    _intervalMinutes = minutes;
    notifyListeners();
  }

  Future<void> loadNearby() async {
    final here = _here;
    if (here == null) return;
    final request = ++_nearbyRequest;
    final type = _type;
    _isLoadingNearby = true;
    _nearbyError = null;
    notifyListeners();
    try {
      final help = await _service.fetchNearby(
          type: type, latitude: here.latitude, longitude: here.longitude);
      if (request == _nearbyRequest) _nearby = help;
    } on SosException catch (e) {
      if (request == _nearbyRequest) _nearbyError = e.message;
    } finally {
      if (request == _nearbyRequest) {
        _isLoadingNearby = false;
        notifyListeners();
      }
    }
  }

  /// Raises an alert to [contacts]. Falls back to the phone's SMS app when the
  /// API is unreachable or cannot send SMS itself.
  Future<void> raise(List<TrustedContact> contacts) async {
    if (_phase != SosPhase.idle) return;
    _phase = SosPhase.sending;
    _error = null;
    _notice = null;
    notifyListeners();

    if (_here == null && !_isLocating) await locate();
    final here = _here;

    try {
      final result = await _service.raiseAlert(
        clientAlertId: createClientSubmissionId(),
        type: _type,
        updateIntervalMinutes: _intervalMinutes,
        latitude: here?.latitude,
        longitude: here?.longitude,
        accuracy: here?.accuracy,
        address: here?.address,
      );
      _becomeActive(result.alert, contactsQueued: result.contactsQueued);
      if (result.alreadyActive) {
        _notice = 'You already had an SOS running. It is shown below.';
      } else {
        _smsEnabled = result.smsEnabled;
        _alertMessage = result.message;
        if (!result.smsEnabled && contacts.isNotEmpty) {
          // The server does not send SMS: the citizen's own phone does, with
          // the live tracking link in place of automatic update texts.
          await _startTexting(contacts, result.message ?? _alertText());
        }
      }
    } on SosException catch (e) {
      _phase = SosPhase.idle;
      if (e.isNetwork && contacts.isNotEmpty) {
        await _startTexting(contacts, _alertText(), offline: true);
      } else if (e.isNetwork) {
        _error = 'No internet and no trusted contacts saved. Call 112.';
      } else {
        _error = e.message;
      }
    } finally {
      notifyListeners();
    }
  }

  /// Texts every contact the alert and its live link again, one by one, for
  /// a citizen who left the messages app without tapping Send.
  Future<void> resendLink(List<TrustedContact> contacts) async {
    if (_alert == null || contacts.isEmpty) return;
    _error = null;
    _notice = null;
    await _startTexting(contacts, _alertMessage ?? _alertText());
    notifyListeners();
  }

  /// Ends the alert, which also stops location sharing. When the server does
  /// not send SMS, the messages app opens with an "I'm safe" text for each of
  /// [contacts] in turn.
  Future<void> markSafe(List<TrustedContact> contacts) async {
    final alert = _alert;
    if (alert == null) return;
    _error = null;
    notifyListeners();
    try {
      final result = await _service.markSafe(alert.publicId);
      await _stopTracker();
      _phase = SosPhase.idle;
      _clearAlert();
      _clearTexts();
      final message = result.message;
      if (result.smsEnabled) {
        _notice = "You're marked safe. Your contacts have been told.";
      } else if (contacts.isEmpty || message == null) {
        _notice = "You're marked safe.";
      } else if (!await _startTexting(contacts, message, safe: true)) {
        _notice = "You're marked safe, but your messages app did not open. "
            'Let your contacts know.';
        _error = null;
      }
    } on SosException catch (e) {
      _error = e.message;
    } finally {
      notifyListeners();
    }
  }

  /// Opens the next contact's text. Called when the citizen comes back from
  /// the messages app, or taps "Text <name>".
  Future<bool> textNext() async {
    final body = _textBody;
    if (_textQueue.isEmpty || body == null || _openingText) return false;
    _openingText = true;
    final contact = _textQueue.first;
    _error = null;
    try {
      if (!await _launchSms(contact.phone, body)) return false;
      _textQueue = _textQueue.sublist(1);
      if (!_textingSafe) {
        _contactsMessaged =
            math.max(_contactsMessaged, _textTotal - _textQueue.length);
      }
      _notice = _textNotice(contact);
      return true;
    } finally {
      _openingText = false;
      notifyListeners();
    }
  }

  /// The app is back in the foreground: carry on with the next contact.
  void onAppResumed() {
    if (_textQueue.isNotEmpty) unawaited(textNext());
  }

  Future<bool> _startTexting(
    List<TrustedContact> contacts,
    String body, {
    bool safe = false,
    bool offline = false,
  }) {
    _textQueue = List.unmodifiable(contacts);
    _textBody = body;
    _textTotal = contacts.length;
    _textingSafe = safe;
    _textingOffline = offline;
    return textNext();
  }

  void _clearTexts() {
    _textQueue = const [];
    _textBody = null;
    _textTotal = 0;
    _textingSafe = false;
    _textingOffline = false;
  }

  String _textNotice(TrustedContact sent) {
    final next = nextTextContact;
    final what = _textingSafe
        ? "You're marked safe. Tap Send to tell ${sent.name}"
        : _textingOffline
            ? 'No internet, so your messages app opened with the alert for '
                '${sent.name}. Tap Send'
            : 'Your messages app opened with your alert and a live location '
                'link for ${sent.name}. Tap Send';
    final count = _textTotal > 1
        ? ' (${_textTotal - _textQueue.length} of $_textTotal)'
        : '';
    if (next != null) {
      return '$what$count, then come back here to text ${next.name}.';
    }
    return _textingSafe ? '$what$count.' : '$what$count, then call 112.';
  }

  String _alertText() {
    final here = _here;
    return offlineAlertText(
      name: _citizenName,
      type: _alert?.type ?? _type,
      latitude: here?.latitude,
      longitude: here?.longitude,
      trackingUrl: _alert?.trackingUrl,
    );
  }

  void _becomeActive(SosAlert alert, {required int? contactsQueued}) {
    if (_alert?.publicId != alert.publicId) {
      _smsEnabled = null;
      _alertMessage = null;
      _contactsMessaged = 0;
    }
    _alert = alert;
    _phase = SosPhase.active;
    if (contactsQueued != null) _contactsQueued = contactsQueued;
    _lastSentAt = alert.lastPingedAt;
    _updatesEnded = alert.updatesStopped;
    _nextUpdateAfter =
        alert.lastPingedAt?.add(Duration(minutes: alert.updateIntervalMinutes));
    if (alert.hasLocation && !alert.updatesStopped && _tracker == null) {
      _startTracker(alert);
    }
  }

  /// Contacts with the live link see every report, so the phone reports
  /// often; without a link only the SMS update interval matters.
  @visibleForTesting
  static Duration reportIntervalFor(SosAlert alert) => alert.trackingUrl != null
      ? liveReportInterval
      : Duration(minutes: alert.updateIntervalMinutes);

  void _startTracker(SosAlert alert) {
    final tracker = SosLocationTracker(
      publicId: alert.publicId,
      interval: reportIntervalFor(alert),
      service: _service,
      onReport: (result, at) {
        if (result.pinged) _lastSentAt = at;
        _nextUpdateAfter = result.nextUpdateAfter ?? _nextUpdateAfter;
        notifyListeners();
      },
      onStopped: () {
        _tracker = null;
        _updatesEnded = true;
        notifyListeners();
      },
    );
    _tracker = tracker;
    tracker.start();
  }

  Future<void> _stopTracker() async {
    final tracker = _tracker;
    _tracker = null;
    await tracker?.stop();
  }

  /// Opens the messages app addressed to [phone]. Returns false (with an
  /// error shown) when it could not be opened.
  Future<bool> _launchSms(String phone, String body) async {
    try {
      // Coming back from the messages app should not ask to unlock again.
      AppLock.instance.allowNextResume();
      if (await launchUrl(smsUri(phone, body))) return true;
    } catch (_) {
      // Reported below.
    }
    _error = 'Could not open your messages app. Call 112.';
    return false;
  }

  @override
  void dispose() {
    unawaited(_stopTracker());
    super.dispose();
  }
}
