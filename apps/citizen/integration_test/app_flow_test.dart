import 'package:civic_report/core/constants/app_constants.dart';
import 'package:civic_report/core/providers/app_settings_provider.dart';
import 'package:civic_report/core/services/api_client.dart';
import 'package:civic_report/core/services/token_storage_service.dart';
import 'package:civic_report/features/auth/providers/auth_provider.dart';
import 'package:civic_report/features/report/screens/location_picker_screen.dart';
import 'package:civic_report/features/sos/screens/sos_screen.dart';
import 'package:civic_report/features/sos/services/sos_location_tracker.dart';
import 'package:civic_report/main.dart';
import 'package:civic_report/shared/widgets/app_bottom_nav.dart';
import 'package:civic_report/shared/widgets/primary_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geocoding_platform_interface/geocoding_platform_interface.dart';
import 'package:geolocator_platform_interface/geolocator_platform_interface.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

import 'support/fake_backend.dart';
import 'support/fake_platforms.dart';

/// On-device tests for everything behind sign-in: home, the report flow,
/// history and details, profile and its sub-screens, and the dark theme.
///
/// The app runs for real on the phone — real widgets, providers, services,
/// secure storage and preferences. Only the edges a test cannot drive or
/// should not touch are replaced: the API (an in-memory [FakeBackend] plugged
/// into the app's own Dio client), the system photo picker, the GPS and the
/// geocoder. No account, server or network is needed, and no real reports are
/// created.
///
///   flutter test integration_test/app_flow_test.dart -d <device>
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  late FakeBackend api;
  late FakeImagePicker picker;
  late FakeGeolocator gps;
  late FakeUrlLauncher launcher;

  setUp(() {
    api = FakeBackend();
    ApiClient.instance.dio.interceptors.add(api);
    picker = FakeImagePicker();
    gps = FakeGeolocator();
    ImagePickerPlatform.instance = picker;
    GeolocatorPlatform.instance = gps;
    GeocodingPlatform.instance = FakeGeocoding();
    launcher = FakeUrlLauncher();
    UrlLauncherPlatform.instance = launcher;
  });

  tearDown(() {
    ApiClient.instance.dio.interceptors.remove(api);
    SosLocationTracker.debugIntervalOverride = null;
    expect(api.unhandled, isEmpty,
        reason: 'The app called endpoints the fake backend does not serve');
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /// Pumps real frames for [duration]. Used instead of pumpAndSettle, which
  /// never returns while a spinner or map tile animation is running.
  Future<void> pumpFor(WidgetTester tester,
      [Duration duration = const Duration(milliseconds: 800)]) async {
    final end = DateTime.now().add(duration);
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Future<void> waitFor(
    WidgetTester tester,
    Finder finder, {
    Duration timeout = const Duration(seconds: 20),
    String? reason,
  }) async {
    final end = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 200));
      if (finder.evaluate().isNotEmpty) return;
    }
    // Say what *was* on screen, so a failure on the phone is diagnosable
    // from the log alone.
    final onScreen = find
        .byType(Text)
        .evaluate()
        .map((e) => (e.widget as Text).data ?? '')
        .where((t) => t.trim().isNotEmpty)
        .toSet()
        .join(' | ');
    fail('${reason ?? 'Timed out waiting for $finder'}\n'
        'On screen: $onScreen\n'
        'Requests: ${api.requests}');
  }

  /// Drops the keyboard, scrolls [finder] into view, taps it, lets it react.
  Future<void> tapOn(WidgetTester tester, Finder finder,
      {Duration wait = const Duration(milliseconds: 900)}) async {
    FocusManager.instance.primaryFocus?.unfocus();
    await pumpFor(tester, const Duration(milliseconds: 400));
    await tester.ensureVisible(finder.first);
    await pumpFor(tester, const Duration(milliseconds: 300));
    await tester.tap(finder.first);
    await pumpFor(tester, wait);
  }

  /// Focuses [field] with a real tap, then types. The tap matters: the test
  /// binding only re-opens the input connection when focus moves to a
  /// *different* field, so typing into the same field again after the
  /// keyboard was dismissed would otherwise be silently dropped.
  Future<void> typeInto(WidgetTester tester, Finder field, String text) async {
    await tester.ensureVisible(field);
    await tester.tap(field);
    await pumpFor(tester, const Duration(milliseconds: 400));
    await tester.enterText(field, text);
    await pumpFor(tester, const Duration(milliseconds: 300));
  }

  Finder navItem(String label) => find.descendant(
        of: find.byType(AppBottomNav),
        matching: find.text(label),
      );

  Future<void> tapNav(WidgetTester tester, String label) =>
      tapOn(tester, navItem(label));

  Future<void> tapBackArrow(WidgetTester tester) =>
      tapOn(tester, find.byIcon(Icons.arrow_back_rounded));

  Future<void> pageBack(WidgetTester tester) async {
    await tester.pageBack();
    await pumpFor(tester);
  }

  Future<void> launch(WidgetTester tester) async {
    final auth = AuthProvider();
    final settings = AppSettingsProvider();
    // Unmount any app from earlier in this test first. Pumping a second
    // CivicReportApp in place would reuse the old router, still bound to the
    // previous AuthProvider — not what a relaunch does.
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(
      CivicReportApp(authProvider: auth, settingsProvider: settings),
    );
    await settings.initialize();
    await auth.initialize();
    await pumpFor(tester, const Duration(seconds: 2));
  }

  /// Starts the app already signed in, past onboarding, on Home.
  Future<void> bootSignedIn(
    WidgetTester tester, {
    bool keepPrefs = false,
    ThemeMode? theme,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    if (!keepPrefs) await prefs.clear();
    await prefs.setBool(AppConstants.keyPermissionsGranted, true);
    if (theme != null) {
      await prefs.setString(AppConstants.keyThemeMode, theme.name);
    }
    await TokenStorageService.instance.saveTokens(
      accessToken: 'fake-access-token',
      refreshToken: 'fake-refresh-token',
      userId: 'u-1',
    );
    await launch(tester);
    await waitFor(tester, find.text('Recent Reports'),
        reason: 'Signed-in launch did not reach Home');
  }

  Future<void> bootSignedOut(WidgetTester tester) async {
    await TokenStorageService.instance.clearAll();
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
    await launch(tester);
    await waitFor(tester, find.text('Welcome Back'));
  }

  Brightness brightnessOf(WidgetTester tester) =>
      Theme.of(tester.element(find.byType(Scaffold).last)).brightness;

  Finder descriptionField() => find.byWidgetPredicate((w) =>
      w is TextField &&
      (w.decoration?.hintText?.startsWith('Provide more details') ?? false));

  /// Opens the report form and waits for categories and a GPS fix.
  Future<void> openReportForm(WidgetTester tester) async {
    await tapOn(tester, find.text('Report Issue'));
    await waitFor(tester, find.text('Report an Issue'));
    await waitFor(tester, find.text('Pothole'),
        reason: 'Categories did not load');
  }

  Future<void> addGalleryPhoto(WidgetTester tester) async {
    final empty = find.text('Upload image of the infrastructure issue');
    await tapOn(
      tester,
      empty.evaluate().isNotEmpty ? empty : find.text('Add more'),
    );
    await waitFor(tester, find.text('Choose from Gallery'));
    await tapOn(tester, find.text('Choose from Gallery'),
        wait: const Duration(seconds: 1));
  }

  Future<void> submitReport(WidgetTester tester) =>
      tapOn(tester, find.widgetWithText(PrimaryButton, 'Submit Report'));

  // ---------------------------------------------------------------------------
  // Sign in
  // ---------------------------------------------------------------------------

  group('sign in', () {
    testWidgets('wrong password is rejected, then sign in reaches Home',
        (tester) async {
      await bootSignedOut(tester);
      final fields = find.byType(TextFormField);

      await typeInto(tester, fields.at(0), 'ada.obi@example.com');
      await typeInto(tester, fields.at(1), 'not-the-password');
      await tapOn(tester, find.widgetWithText(PrimaryButton, 'Sign In'));
      await waitFor(tester, find.text('Invalid email or password'));
      expect(await TokenStorageService.instance.getAccessToken(), isNull);

      await typeInto(tester, fields.at(1), FakeBackend.password);
      await tapOn(tester, find.widgetWithText(PrimaryButton, 'Sign In'));

      // A first sign-in goes through the permissions screen.
      await waitFor(tester, find.text('Allow Access'));
      await tapOn(tester, find.text('Skip for now'));
      await waitFor(tester, find.text('Recent Reports'));

      expect(find.text('Hello, Ada 👋'), findsOneWidget);
      expect(await TokenStorageService.instance.getAccessToken(),
          'fake-access-token');
    });

    testWidgets('a saved session skips login on relaunch', (tester) async {
      await bootSignedIn(tester);
      expect(find.text('Welcome Back'), findsNothing);
      expect(api.sent('GET', '/api/auth/me'), isNotEmpty);
    });
  });

  // ---------------------------------------------------------------------------
  // Home
  // ---------------------------------------------------------------------------

  group('home', () {
    testWidgets('shows greeting, location and the three recent reports',
        (tester) async {
      await bootSignedIn(tester);

      expect(find.text('Hello, Ada 👋'), findsOneWidget);
      expect(find.text('Admiralty Way, Lekki, Lagos'), findsWidgets);
      expect(find.text('Blocked drain flooding the junction'), findsOneWidget);
      expect(find.text('Streetlight out on Bourdillon Road'), findsOneWidget);
      expect(find.text('Deep pothole near the bus stop'), findsOneWidget);
      expect(find.text('Submitted'), findsOneWidget);
    });

    testWidgets('search narrows recent reports and reports no match',
        (tester) async {
      await bootSignedIn(tester);
      final search = find.byWidgetPredicate((w) =>
          w is TextField &&
          (w.decoration?.hintText?.startsWith('Search reports') ?? false));

      await tester.enterText(search, 'pothole');
      await pumpFor(tester, const Duration(seconds: 1));
      expect(find.text('Deep pothole near the bus stop'), findsOneWidget);
      expect(find.text('Blocked drain flooding the junction'), findsNothing);
      expect(
        api.sent('GET', '/api/reports')
            .any((r) => r.options.queryParameters['q'] == 'pothole'),
        isTrue,
      );

      await tester.enterText(search, 'zzz-nothing');
      await pumpFor(tester, const Duration(seconds: 1));
      expect(find.text('No reports match your search.'), findsOneWidget);

      await tester.enterText(search, '');
      await pumpFor(tester);
      expect(find.text('Blocked drain flooding the junction'), findsOneWidget);
    });

    testWidgets('Pending stat card opens History filtered to pending',
        (tester) async {
      await bootSignedIn(tester);
      await tapOn(tester, find.widgetWithText(InkWell, 'Pending'));
      await waitFor(tester, find.text('My Reports'));
      await pumpFor(tester);

      expect(find.text('Blocked drain flooding the junction'), findsOneWidget);
      expect(find.text('Deep pothole near the bus stop'), findsNothing);
      expect(
        api.sent('GET', '/api/reports')
            .any((r) => r.options.queryParameters['status'] == 'PENDING'),
        isTrue,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Reporting
  // ---------------------------------------------------------------------------

  group('report an issue', () {
    testWidgets('full report: category, GPS pin, photo, description, submit',
        (tester) async {
      await bootSignedIn(tester);
      await openReportForm(tester);

      // Nothing chosen yet, so Submit explains what is missing.
      expect(find.text('Add a category and at least one photo to submit.'),
          findsOneWidget);

      // GPS fix arrives as a candidate pin the citizen confirms.
      await waitFor(tester, find.text('Use this location'),
          reason: 'GPS candidate was not offered');
      await tapOn(tester, find.text('Use this location'));
      await waitFor(tester, find.text(FakeGeocoding.address));

      await tapOn(tester, find.text('Pothole'));
      expect(find.text('Add at least one photo to submit.'), findsOneWidget);

      // Add, remove, and add again.
      await addGalleryPhoto(tester);
      await waitFor(tester, find.text('1 of 5'));
      expect(picker.lastSource, ImageSource.gallery);
      await tapOn(tester, find.byIcon(Icons.close_rounded));
      expect(find.text('0 of 5'), findsOneWidget);
      await addGalleryPhoto(tester);
      await waitFor(tester, find.text('1 of 5'));

      await tester.ensureVisible(descriptionField());
      await tester.enterText(
          descriptionField(), 'Deep pothole by the school gate');
      await pumpFor(tester);
      expect(find.text('31 / 1000'), findsOneWidget);

      await submitReport(tester);
      await waitFor(tester, find.text('Report CR-2001 submitted.'));
      await waitFor(tester, find.text('Recent Reports'));

      final post = api.sent('POST', '/api/reports').single;
      expect(post.field('categoryId'), 'cat-pothole');
      expect(post.field('description'), 'Deep pothole by the school gate');
      expect(post.field('latitude'), FakeGeolocator.latitude.toString());
      expect(post.field('longitude'), FakeGeolocator.longitude.toString());
      expect(post.field('address'), FakeGeocoding.address);
      expect(post.field('clientSubmissionId'), isNotEmpty);
      expect(post.fileCount, 1);
      expect(post.options.headers['Authorization'], 'Bearer fake-access-token');

      // The new report is on Home straight away.
      await waitFor(tester, find.text('Deep pothole by the school gate'));
    });

    testWidgets('a rejected submission keeps the draft and can be retried',
        (tester) async {
      await bootSignedIn(tester);
      await openReportForm(tester);
      await tapOn(tester, find.text('Flooding'));
      await addGalleryPhoto(tester);
      await waitFor(tester, find.text('1 of 5'));

      api.failNext['POST /api/reports'] =
          (status: 400, body: {'error': 'The photo could not be read.'});
      await submitReport(tester);
      await waitFor(tester, find.text('The photo could not be read.'));
      expect(find.text('Report an Issue'), findsOneWidget);
      expect(find.text('1 of 5'), findsOneWidget);

      await submitReport(tester);
      await waitFor(tester, find.text('Report CR-2001 submitted.'));
      expect(api.sent('POST', '/api/reports'), hasLength(2));
    });

    testWidgets('denied location still lets the report go without one',
        (tester) async {
      gps.permission = LocationPermission.denied;
      await bootSignedIn(tester);
      await openReportForm(tester);

      await waitFor(tester,
          find.text('Location access denied. You can still submit without it.'));
      expect(find.text('Try again'), findsOneWidget);

      await tapOn(tester, find.text('Waste'));
      await addGalleryPhoto(tester);
      await waitFor(tester, find.text('1 of 5'));
      await submitReport(tester);
      await waitFor(tester, find.text('Report CR-2001 submitted.'));

      final post = api.sent('POST', '/api/reports').single;
      expect(post.field('latitude'), isNull);
      expect(post.field('categoryId'), 'cat-waste');
    });

    // -------------------------------------------------------------------------
    // Manual location
    // -------------------------------------------------------------------------

    final computerVillage = FakeBackend.placeResults.first;
    final searchField = find.byKey(LocationPickerScreen.searchFieldKey);

    testWidgets('denied GPS: search for a place and submit it', (tester) async {
      gps.permission = LocationPermission.denied;
      await bootSignedIn(tester);
      await openReportForm(tester);
      await waitFor(tester,
          find.text('Location access denied. You can still submit without it.'));

      await tapOn(tester, find.text('Choose on map'));
      await waitFor(tester, find.text('Choose location'));
      // Nothing chosen yet, so there is nothing to confirm.
      expect(
        tester
            .widget<ButtonStyleButton>(find.ancestor(
              of: find.text('Use this location'),
              matching: find.byWidgetPredicate((w) => w is ButtonStyleButton),
            ))
            .onPressed,
        isNull,
      );

      await typeInto(tester, searchField, 'Computer Vil');
      await waitFor(tester, find.text(computerVillage['label'] as String),
          reason: 'Search results did not appear');
      final search = api.sent('GET', '/api/geo/search').last;
      expect(search.options.queryParameters['q'], 'Computer Vil');
      // No GPS fix to rank results near.
      expect(search.options.queryParameters.containsKey('lat'), isFalse);

      await tapOn(tester, find.text(computerVillage['label'] as String));
      await tapOn(tester, find.text('Use this location'));
      await waitFor(tester, find.text('Report an Issue'));
      await waitFor(tester, find.text(computerVillage['label'] as String));
      expect(find.textContaining('Set manually'), findsOneWidget);
      expect(find.text('Change location'), findsOneWidget);

      await tapOn(tester, find.text('Pothole'));
      await addGalleryPhoto(tester);
      await waitFor(tester, find.text('1 of 5'));
      await submitReport(tester);
      await waitFor(tester, find.text('Report CR-2001 submitted.'));

      final post = api.sent('POST', '/api/reports').single;
      expect(post.field('latitude'), computerVillage['latitude'].toString());
      expect(post.field('longitude'), computerVillage['longitude'].toString());
      expect(post.field('address'), computerVillage['label']);
      // A picked place is not a GPS fix, so no accuracy is claimed.
      expect(post.field('accuracy'), isNull);
    });

    testWidgets('search outage still allows dropping a pin on the map',
        (tester) async {
      gps.permission = LocationPermission.denied;
      await bootSignedIn(tester);
      await openReportForm(tester);
      await waitFor(tester, find.text('Choose on map'));
      await tapOn(tester, find.text('Choose on map'));
      await waitFor(tester, find.text('Choose location'));

      api.failNext['GET /api/geo/search'] = (
        status: 503,
        body: {'error': 'Location search is temporarily unavailable'},
      );
      await typeInto(tester, searchField, 'Allen');
      await waitFor(
          tester, find.text('Location search is temporarily unavailable'));

      // Tap the middle of the map to drop a pin there.
      FocusManager.instance.primaryFocus?.unfocus();
      await pumpFor(tester, const Duration(milliseconds: 400));
      await tester.tap(find.byType(FlutterMap));
      await pumpFor(tester);
      await waitFor(tester, find.text('Pin dropped on the map'));
      await tapOn(tester, find.text('Use this location'));

      // A dropped pin has no name, so the form reverse-geocodes it.
      await waitFor(tester, find.text('Report an Issue'));
      await waitFor(tester, find.text(FakeGeocoding.address));

      await tapOn(tester, find.text('Waste'));
      await addGalleryPhoto(tester);
      await waitFor(tester, find.text('1 of 5'));
      await submitReport(tester);
      await waitFor(tester, find.text('Report CR-2001 submitted.'));

      final post = api.sent('POST', '/api/reports').single;
      // The map opened on the whole of Nigeria, centred near Abuja.
      expect(double.parse(post.field('latitude')!), closeTo(9.08, 1.5));
      expect(double.parse(post.field('longitude')!), closeTo(8.68, 1.5));
      expect(post.field('address'), FakeGeocoding.address);
      expect(post.field('accuracy'), isNull);
    });

    testWidgets('a confirmed GPS location can be changed by search',
        (tester) async {
      await bootSignedIn(tester);
      await openReportForm(tester);
      await waitFor(tester, find.text('Use this location'));
      await tapOn(tester, find.text('Use this location'));
      await waitFor(tester, find.text(FakeGeocoding.address));

      await tapOn(tester, find.text('Change location'));
      await waitFor(tester, find.text('Choose location'));
      await typeInto(tester, searchField, 'Computer Village');
      await waitFor(tester, find.text(computerVillage['label'] as String));
      // Results are ranked near the GPS fix the citizen already had.
      final search = api.sent('GET', '/api/geo/search').last;
      expect(search.options.queryParameters['lat'], FakeGeolocator.latitude);
      expect(search.options.queryParameters['lon'], FakeGeolocator.longitude);

      await tapOn(tester, find.text(computerVillage['label'] as String));
      await tapOn(tester, find.text('Use this location'));
      await waitFor(tester, find.text('Report an Issue'));
      await waitFor(tester, find.text(computerVillage['label'] as String));
      expect(find.text(FakeGeocoding.address), findsNothing);

      await tapOn(tester, find.text('Streetlight'));
      await addGalleryPhoto(tester);
      await waitFor(tester, find.text('1 of 5'));
      await submitReport(tester);
      await waitFor(tester, find.text('Report CR-2001 submitted.'));

      final post = api.sent('POST', '/api/reports').single;
      expect(post.field('address'), computerVillage['label']);
      expect(post.field('latitude'), computerVillage['latitude'].toString());
    });

    testWidgets('cancelled photo pick changes nothing', (tester) async {
      picker.returnPhoto = false;
      await bootSignedIn(tester);
      await openReportForm(tester);
      await addGalleryPhoto(tester);
      expect(picker.calls, 1);
      expect(find.text('0 of 5'), findsOneWidget);
      expect(find.byType(SnackBar), findsNothing);
    });

    testWidgets('category load failure shows Retry, which recovers',
        (tester) async {
      api.failNext['GET /api/reports/categories'] =
          (status: 500, body: {'error': 'Database unavailable'});
      await bootSignedIn(tester);
      await tapOn(tester, find.text('Report Issue'));
      await waitFor(tester, find.text('Database unavailable'));

      await tapOn(tester, find.text('Retry'));
      await waitFor(tester, find.text('Pothole'));
    });

    testWidgets('leaving the form discards the draft', (tester) async {
      await bootSignedIn(tester);
      await openReportForm(tester);
      await tapOn(tester, find.text('Pothole'));
      await addGalleryPhoto(tester);
      await waitFor(tester, find.text('1 of 5'));

      await tapNav(tester, 'Home');
      await waitFor(tester, find.text('Recent Reports'));
      await openReportForm(tester);

      expect(find.text('0 of 5'), findsOneWidget);
      expect(find.text('Add a category and at least one photo to submit.'),
          findsOneWidget);
    });
  });

  // ---------------------------------------------------------------------------
  // History and details
  // ---------------------------------------------------------------------------

  group('history', () {
    Finder chip(String label) => find.descendant(
          of: find.byType(SingleChildScrollView),
          matching: find.text(label),
        );

    testWidgets('status chips filter the list', (tester) async {
      await bootSignedIn(tester);
      await tapNav(tester, 'History');
      await waitFor(tester, find.text('My Reports'));
      await waitFor(tester, find.text('Deep pothole near the bus stop'));
      expect(find.text('Blocked drain flooding the junction'), findsOneWidget);

      await tapOn(tester, chip('Resolved'));
      await pumpFor(tester);
      expect(find.text('Deep pothole near the bus stop'), findsOneWidget);
      expect(find.text('Blocked drain flooding the junction'), findsNothing);

      await tapOn(tester, chip('In Progress'));
      await pumpFor(tester);
      expect(find.text('Streetlight out on Bourdillon Road'), findsOneWidget);
      expect(find.text('Deep pothole near the bus stop'), findsNothing);

      await tapOn(tester, chip('Rejected'));
      await pumpFor(tester);
      expect(find.text('No rejected reports'), findsOneWidget);

      await tapOn(tester, chip('All'));
      await pumpFor(tester);
      expect(find.text('Deep pothole near the bus stop'), findsOneWidget);
      expect(find.text('Blocked drain flooding the junction'), findsOneWidget);
    });

    testWidgets('report details show facts, AI check and timeline',
        (tester) async {
      await bootSignedIn(tester);
      await tapNav(tester, 'History');
      await waitFor(tester, find.text('Deep pothole near the bus stop'));
      await tapOn(tester, find.text('Deep pothole near the bus stop'));
      await waitFor(tester, find.text('Report Details'));
      await pumpFor(tester);

      expect(find.text('CR-1001'), findsOneWidget);
      expect(find.text('Allen Avenue, Ikeja, Lagos'), findsOneWidget);
      expect(find.text('High'), findsOneWidget);
      expect(find.text('Lagos State Public Works'), findsOneWidget);
      expect(find.text('CIV-2026-1001'), findsOneWidget);
      expect(find.text('AI agrees this is Pothole (91% confident)'),
          findsOneWidget);
      expect(api.sent('GET', '/api/reports/CR-1001'), isNotEmpty);

      await tester.scrollUntilVisible(find.text('Share receipt').last, 200,
          scrollable: find.byType(Scrollable).last);
      expect(find.text('Progress timeline'), findsOneWidget);
      expect(find.text('In Progress'), findsWidgets);

      await tapBackArrow(tester);
      await waitFor(tester, find.text('My Reports'));
    });

    testWidgets('an unknown report id shows a recoverable error',
        (tester) async {
      // A stale notification pointing at a report the server no longer has.
      api.notifications.first['data'] = {'route': '/report-details/CR-9999'};
      await bootSignedIn(tester);
      await tapOn(tester, find.byIcon(Icons.notifications_outlined));
      await waitFor(tester, find.text('Report CR-1001 resolved'));
      await tapOn(tester, find.text('Report CR-1001 resolved'));

      await waitFor(tester, find.text('Report not found'));
      expect(find.text('Try again'), findsOneWidget);
      await tapOn(tester, find.text('Back to my reports'));
      await waitFor(tester, find.text('My Reports'));
    });
  });

  // ---------------------------------------------------------------------------
  // Profile
  // ---------------------------------------------------------------------------

  group('profile', () {
    testWidgets('shows identity, stats and version', (tester) async {
      await bootSignedIn(tester);
      await tapNav(tester, 'Profile');
      await waitFor(tester, find.text('Edit Profile'));
      await pumpFor(tester);

      expect(find.text('Ada Obi'), findsOneWidget);
      expect(find.text('AO'), findsOneWidget);
      expect(find.text('ada.obi@example.com'), findsOneWidget);
      expect(find.text('Admiralty Way, Lekki, Lagos'), findsOneWidget);
      expect(find.text('42'), findsOneWidget);
      expect(find.textContaining(RegExp(r'^v\d')), findsOneWidget);
    });

    testWidgets('edit profile validates and saves', (tester) async {
      await bootSignedIn(tester);
      await tapNav(tester, 'Profile');
      await tapOn(tester, find.text('Edit Profile'));
      await waitFor(tester, find.text('Save changes'));

      final name = find.byType(TextFormField).at(0);
      final phone = find.byType(TextFormField).at(1);
      expect(find.text('ada.obi@example.com'), findsOneWidget);

      await typeInto(tester, name, 'A');
      await tapOn(tester, find.text('Save changes'));
      expect(find.text('Enter your full name'), findsOneWidget);
      expect(api.sent('PATCH', '/api/auth/me'), isEmpty);

      await typeInto(tester, name, 'Ada Obi-Nwosu');
      await typeInto(tester, phone, '08031234567');
      await tapOn(tester, find.text('Save changes'));
      await waitFor(tester, find.text('Profile updated'));
      await waitFor(tester, find.text('Ada Obi-Nwosu'));

      final patch = api.sent('PATCH', '/api/auth/me').single;
      expect(patch.json['fullName'], 'Ada Obi-Nwosu');
      expect(patch.json['phone'], '08031234567');
    });

    testWidgets('notifications: inbox, open an update, toggle preference',
        (tester) async {
      await bootSignedIn(tester);
      await tapOn(tester, find.byIcon(Icons.notifications_outlined));
      await waitFor(tester, find.text('Report CR-1001 resolved'));

      await tapOn(tester, find.text('Report CR-1001 resolved'));
      await waitFor(tester, find.text('Report Details'));
      expect(api.sent('POST', '/api/notifications/n-1/read'), hasLength(1));
      await tapBackArrow(tester);
      await waitFor(tester, find.text('Report updates'));

      await tapOn(tester, find.byType(Switch));
      await waitFor(
          tester, find.text('Report update notifications are turned off.'));
      expect(
        api.sent('PATCH', '/api/notifications/preferences').last
            .json['reportUpdatesEnabled'],
        false,
      );

      await tapOn(tester, find.byType(Switch));
      await waitFor(tester, find.text('Report CR-1001 resolved'));
      expect(api.reportUpdatesEnabled, isTrue);
    });

    testWidgets('help, about and back', (tester) async {
      await bootSignedIn(tester);
      await tapNav(tester, 'Profile');
      for (final row in ['Help & Support', 'About']) {
        await tapOn(tester, find.text(row));
        expect(find.text('Edit Profile').hitTestable(), findsNothing,
            reason: '$row did not open');
        await pageBack(tester);
        expect(find.text('Edit Profile'), findsOneWidget);
      }
    });

    testWidgets('log out revokes the session and returns to login',
        (tester) async {
      await bootSignedIn(tester);
      await tapNav(tester, 'Profile');
      await tapOn(tester, find.text('Log Out'));
      await waitFor(tester, find.text('Welcome Back'));

      expect(await TokenStorageService.instance.getAccessToken(), isNull);
      expect(api.sent('POST', '/api/auth/logout').single.json['refreshToken'],
          'fake-refresh-token');
    });
  });

  // ---------------------------------------------------------------------------
  // SOS
  // ---------------------------------------------------------------------------

  group('sos', () {
    const chidi = {'id': 'tc-a', 'name': 'Chidi', 'phone': '+2348055551234', 'relationship': null};
    const ngozi = {'id': 'tc-b', 'name': 'Ngozi', 'phone': '+2348066661234', 'relationship': 'Sister'};

    Future<void> openSos(WidgetTester tester) async {
      await tapOn(tester, find.text('SOS'));
      await waitFor(tester, find.text('Call 112'));
    }

    /// Holds the SOS button through the hold, then waits out the countdown.
    Future<void> holdToSend(WidgetTester tester) async {
      final button = find.text('Hold to send SOS');
      await tester.ensureVisible(button);
      await pumpFor(tester, const Duration(milliseconds: 300));
      final gesture = await tester.startGesture(tester.getCenter(button));
      await pumpFor(tester, SosScreen.holdDuration + const Duration(milliseconds: 600));
      await gesture.up();
      await waitFor(tester, find.textContaining('Sending in'));
      await pumpFor(tester, const Duration(seconds: SosScreen.countdownSeconds + 1));
    }

    Future<void> waitForRequest(WidgetTester tester, String method, String path) async {
      final end = DateTime.now().add(const Duration(seconds: 20));
      while (DateTime.now().isBefore(end)) {
        await tester.pump(const Duration(milliseconds: 200));
        if (api.sent(method, path).isNotEmpty) return;
      }
      fail('Timed out waiting for $method $path\nRequests: ${api.requests}');
    }

    testWidgets('trusted contacts: add, edit, remove, and the limit of five',
        (tester) async {
      await bootSignedIn(tester);
      await tapNav(tester, 'Profile');
      await tapOn(tester, find.text('Trusted Contacts'));
      await waitFor(tester, find.text('No trusted contacts yet.'));

      // Add, with a bad number first.
      await tapOn(tester, find.text('Add contact'));
      await typeInto(tester, find.byKey(const ValueKey('contact-name')), 'Chidi Obi');
      await typeInto(tester, find.byKey(const ValueKey('contact-phone')), '12345');
      await tapOn(tester, find.text('Save'));
      expect(find.text('Enter a valid phone number, e.g. 0803 123 4567'), findsOneWidget);
      await typeInto(tester, find.byKey(const ValueKey('contact-phone')), '0805 555 1234');
      await tapOn(tester, find.text('Save'));
      await waitFor(tester, find.text('+2348055551234'));
      expect(api.sent('POST', '/api/sos/contacts').single.json['phone'], '0805 555 1234');

      // Edit.
      await tapOn(tester, find.text('Chidi Obi'));
      await typeInto(tester, find.byKey(const ValueKey('contact-name')), 'Chidi O.');
      await typeInto(tester, find.byKey(const ValueKey('contact-relationship')), 'Brother');
      await tapOn(tester, find.text('Save'));
      await waitFor(tester, find.text('+2348055551234 · Brother'));
      expect(find.text('Chidi O.'), findsOneWidget);
      expect(api.sent('PATCH', '/api/sos/contacts/tc-1').single.json['name'], 'Chidi O.');

      // Remove.
      await tapOn(tester, find.byTooltip('Remove Chidi O.'));
      await tapOn(tester, find.text('Remove'));
      await waitFor(tester, find.text('No trusted contacts yet.'));
      expect(api.sent('DELETE', '/api/sos/contacts/tc-1'), hasLength(1));

      // At five contacts there is no way to add a sixth.
      api.sosContacts = [
        for (var i = 1; i <= 5; i++)
          {'id': 'tc-x$i', 'name': 'Contact $i', 'phone': '+23480555500$i$i', 'relationship': null},
      ];
      await pageBack(tester);
      await tapOn(tester, find.text('Trusted Contacts'));
      await waitFor(tester, find.text('Contact 5'));
      expect(find.text('Add contact'), findsNothing);
      expect(find.text("You've added the maximum of 5 contacts."), findsOneWidget);
    });

    testWidgets('medical SOS: help nearby, call, hold to alert contacts, then safe',
        (tester) async {
      api.sosContacts = [Map.of(chidi), Map.of(ngozi)];
      await bootSignedIn(tester);
      await openSos(tester);

      // Help nearby for the default (medical) type, nearest first.
      await waitFor(tester, find.text('Ikeja Medical Centre'),
          reason: 'Nearby hospitals did not load');
      final nearby = api.sent('GET', '/api/sos/nearby').last.options.queryParameters;
      expect(nearby['type'], 'MEDICAL');
      expect(nearby['lat'], FakeGeolocator.latitude);
      expect(nearby['lon'], FakeGeolocator.longitude);
      expect(
        tester.getTopLeft(find.text('Ikeja Medical Centre')).dy,
        lessThan(tester.getTopLeft(find.text('Lagos State University Teaching Hospital')).dy),
      );
      expect(find.text('Hospital · 140 m\nAllen Avenue, Ikeja'), findsOneWidget);
      expect(find.text('Alerts go to Chidi, Ngozi.'), findsOneWidget);

      // Calling 112 and a facility open the dialer with the right numbers.
      await tapOn(tester, find.text('Call 112'));
      expect(launcher.launched.last, 'tel:112');
      await tapOn(tester, find.byTooltip('Call Ikeja Medical Centre'));
      expect(launcher.launched.last, 'tel:08011112222');

      await tapOn(tester, find.text('Every 15 min'));
      await holdToSend(tester);
      await waitFor(tester, find.text('SOS active · Medical'));
      expect(find.text('2 trusted contacts alerted by text.'), findsOneWidget);
      expect(find.text('No responder has been sent. Call 112 for emergency services.'), findsOneWidget);

      final alert = api.sent('POST', '/api/sos/alerts').single.json;
      expect(alert['type'], 'MEDICAL');
      expect(alert['updateIntervalMinutes'], 15);
      expect(alert['lat'], FakeGeolocator.latitude);
      expect(alert['lon'], FakeGeolocator.longitude);
      expect(alert['clientAlertId'], matches(RegExp(r'^[0-9a-f-]{36}$')));

      await tapOn(tester, find.text("I'm safe"));
      await waitFor(tester, find.text("You're marked safe. Your contacts have been told."));
      expect(api.sent('POST', '/api/sos/alerts/SOS-1000/safe'), hasLength(1));
      expect(find.text('Hold to send SOS'), findsOneWidget);
    });

    testWidgets('without server SMS the phone sends the alert, a live link and the safe text',
        (tester) async {
      api.sosSmsEnabled = false;
      api.sosContacts = [Map.of(chidi), Map.of(ngozi)];
      await bootSignedIn(tester);
      await openSos(tester);
      await waitFor(tester, find.text('Ikeja Medical Centre'));
      // No update texts to space out: contacts follow the live link instead.
      expect(find.text('Every 15 min'), findsNothing);

      await holdToSend(tester);
      await waitFor(tester, find.text('SOS active · Medical'));
      // One text per contact: a text to both at once becomes a group MMS.
      final alertSms = launcher.launched.last;
      expect(alertSms, startsWith('sms:+2348055551234?body='));
      expect(Uri.decodeComponent(alertSms), contains('Live location: ${FakeBackend.sosTrackingUrl}'));
      expect(find.textContaining('then come back here to text Ngozi'), findsOneWidget);
      expect(find.textContaining('for 1 of 2 contacts'), findsOneWidget);
      expect(find.text('Your contacts can follow your live location from the link in your alert.'),
          findsOneWidget);

      await tapOn(tester, find.text('Text Ngozi (2 of 2)'));
      expect(launcher.launched.last, startsWith('sms:+2348066661234?body='));
      expect(launcher.launched.last.substring(launcher.launched.last.indexOf('?')),
          alertSms.substring(alertSms.indexOf('?')));
      await waitFor(tester, find.textContaining('for all 2 contacts'));
      expect(find.textContaining('Text Ngozi'), findsNothing);

      // Left the messages app without sending: send it again, from the top.
      final launches = launcher.launched.length;
      await tapOn(tester, find.text('Resend link'));
      expect(launcher.launched, hasLength(launches + 1));
      expect(launcher.launched.last, alertSms);
      await tapOn(tester, find.text('Text Ngozi (2 of 2)'));

      // No way to stop sharing except marking safe.
      expect(find.text('Stop sharing location'), findsNothing);
      await tapOn(tester, find.text("I'm safe"));
      await waitFor(tester, find.textContaining("You're marked safe. Tap Send to tell Chidi"));
      expect(launcher.launched.last, startsWith('sms:+2348055551234?body='));
      expect(Uri.decodeComponent(launcher.launched.last),
          contains('Ada Obi has marked themselves safe via CivicAI'));
      await tapOn(tester, find.text('Text Ngozi (2 of 2)'));
      expect(launcher.launched.last, startsWith('sms:+2348066661234?body='));
      expect(find.text('Hold to send SOS'), findsOneWidget);
    });

    testWidgets('releasing early or cancelling the countdown sends nothing',
        (tester) async {
      api.sosContacts = [Map.of(chidi)];
      await bootSignedIn(tester);
      await openSos(tester);
      final button = find.text('Hold to send SOS');
      await tester.ensureVisible(button);
      await pumpFor(tester, const Duration(milliseconds: 300));

      // A short press is not enough.
      final quick = await tester.startGesture(tester.getCenter(button));
      await pumpFor(tester, const Duration(milliseconds: 700));
      await quick.up();
      await pumpFor(tester, const Duration(seconds: 2));
      expect(find.textContaining('Sending in'), findsNothing);

      // A full hold starts the countdown, which can still be cancelled.
      final hold = await tester.startGesture(tester.getCenter(button));
      await pumpFor(tester, SosScreen.holdDuration + const Duration(milliseconds: 600));
      await hold.up();
      await waitFor(tester, find.textContaining('Sending in'));
      await tapOn(tester, find.text('Cancel'));
      await pumpFor(tester, const Duration(seconds: SosScreen.countdownSeconds + 1));
      expect(api.sent('POST', '/api/sos/alerts'), isEmpty);
      expect(find.text('Hold to send SOS'), findsOneWidget);
    });

    testWidgets('offline: the messages app opens for each contact in turn',
        (tester) async {
      api.sosContacts = [Map.of(chidi), Map.of(ngozi)];
      await bootSignedIn(tester);
      await openSos(tester);
      await waitFor(tester, find.text('Ikeja Medical Centre'));
      await tapOn(tester, find.text('Security'));

      api.failNetworkNext.add('POST /api/sos/alerts');
      await holdToSend(tester);
      await waitFor(tester, find.textContaining('No internet, so your messages app opened'));

      final sms = launcher.launched.last;
      expect(sms, startsWith('sms:+2348055551234?body='));
      await tapOn(tester, find.text('Text Ngozi (2 of 2)'));
      expect(launcher.launched.last, startsWith('sms:+2348066661234?body='));
      final body = Uri.decodeComponent(sms.substring(sms.indexOf('body=') + 5));
      expect(body, contains('SOS: Ada Obi needs help - SECURITY emergency.'));
      expect(body, contains('https://maps.google.com/?q=6.60180,3.35150'));
      // No alert exists server-side, so the screen stays ready to try again.
      expect(find.text('Hold to send SOS'), findsOneWidget);
    });

    testWidgets('location updates are reported and stop when the server ends them',
        (tester) async {
      SosLocationTracker.debugIntervalOverride = const Duration(seconds: 1);
      api.sosContacts = [Map.of(chidi)];
      api.sosStopUpdates = true;
      await bootSignedIn(tester);
      await openSos(tester);
      await waitFor(tester, find.text('Ikeja Medical Centre'));

      await holdToSend(tester);
      await waitFor(tester, find.text('SOS active · Medical'));
      expect(api.sent('POST', '/api/sos/alerts').single.json['updateIntervalMinutes'], 30);

      await waitForRequest(tester, 'POST', '/api/sos/alerts/SOS-1000/location');
      final update = api.sent('POST', '/api/sos/alerts/SOS-1000/location').first.json;
      expect(update['lat'], FakeGeolocator.latitude);
      expect(update['lon'], FakeGeolocator.longitude);
      expect(update['recordedAt'], isNotEmpty);

      await waitFor(tester, find.text('Location updates have stopped.'));
      expect(find.text('Stop sharing location'), findsNothing);
      // The alert itself is still active until the citizen is safe.
      expect(find.text("I'm safe"), findsOneWidget);
    });

    testWidgets('an alert still running is shown when SOS is reopened',
        (tester) async {
      api.sosActiveAlert = {
        'publicId': 'SOS-1000', 'type': 'FIRE', 'status': 'ACTIVE',
        'latitude': null, 'longitude': null, 'accuracy': null,
        'updateIntervalMinutes': 30, 'lastPingedAt': null, 'pingCount': 0,
        'updatesStoppedAt': null, 'createdAt': DateTime.now().toUtc().toIso8601String(),
        'resolvedAt': null,
      };
      await bootSignedIn(tester);
      await openSos(tester);
      await waitFor(tester, find.text('SOS active · Fire'));
      expect(find.text('Your location was not available, so no location updates will be sent.'),
          findsOneWidget);
      expect(find.text('Hold to send SOS'), findsNothing);
    });
  });

  // ---------------------------------------------------------------------------
  // Dark theme
  // ---------------------------------------------------------------------------

  group('dark theme', () {
    Future<void> pickAppearance(WidgetTester tester, String option) async {
      await tapOn(tester, find.text('Appearance'));
      await waitFor(tester, find.byType(SimpleDialog));
      await tapOn(
        tester,
        find.descendant(
            of: find.byType(SimpleDialog), matching: find.text(option)),
      );
    }

    testWidgets('Appearance switches to dark, persists, survives relaunch',
        (tester) async {
      await bootSignedIn(tester);
      expect(brightnessOf(tester), Brightness.light);
      await tapNav(tester, 'Profile');

      await tapOn(tester, find.text('Appearance'));
      expect(find.text('Match device setting'), findsOneWidget);
      await tester.tapAt(const Offset(20, 60)); // dismiss without choosing
      await pumpFor(tester);
      expect(brightnessOf(tester), Brightness.light);

      await pickAppearance(tester, 'Dark');
      expect(brightnessOf(tester), Brightness.dark);
      expect(find.text('Dark'), findsOneWidget); // row trailing label
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString(AppConstants.keyThemeMode), 'dark');

      await bootSignedIn(tester, keepPrefs: true);
      expect(brightnessOf(tester), Brightness.dark);

      await tapNav(tester, 'Profile');
      await pickAppearance(tester, 'Light');
      expect(brightnessOf(tester), Brightness.light);
      expect(prefs.getString(AppConstants.keyThemeMode), 'light');
    });

    /// Visits every signed-in screen, calling [check] on each.
    Future<void> walkScreens(
        WidgetTester tester, void Function(String screen) check) async {
      check('Home');

      await tapOn(tester, find.text('SOS'));
      await waitFor(tester, find.text('Ikeja Medical Centre'));
      check('SOS');
      await pageBack(tester);

      await tapOn(tester, find.byIcon(Icons.notifications_outlined));
      await waitFor(tester, find.text('Report CR-1001 resolved'));
      check('Notifications');
      await pageBack(tester);

      await openReportForm(tester);
      await waitFor(tester, find.text('Use this location'));
      await tapOn(tester, find.text('Pothole'));
      check('Report form');
      await tapOn(tester, find.text('Upload image of the infrastructure issue'));
      await waitFor(tester, find.text('Choose from Gallery'));
      check('Photo source sheet');
      await tester.tapAt(const Offset(20, 60));
      await pumpFor(tester);

      await tapNav(tester, 'History');
      await waitFor(tester, find.text('Deep pothole near the bus stop'));
      check('History');

      await tapOn(tester, find.text('Deep pothole near the bus stop'));
      await waitFor(tester, find.text('Report Details'));
      await pumpFor(tester);
      check('Report details');
      await tapBackArrow(tester);

      await tapNav(tester, 'Profile');
      await waitFor(tester, find.text('Edit Profile'));
      check('Profile');

      await tapOn(tester, find.text('Appearance'));
      check('Appearance dialog');
      await tester.tapAt(const Offset(20, 60));
      await pumpFor(tester);

      for (final row in ['Edit Profile', 'Help & Support', 'About']) {
        await tapOn(tester, find.text(row));
        check(row);
        await pageBack(tester);
      }
    }

    testWidgets('every screen uses dark surfaces', (tester) async {
      await bootSignedIn(tester, theme: ThemeMode.dark);
      final problems = <String>[];

      await walkScreens(tester, (screen) {
        for (final element in find.byType(Scaffold).evaluate()) {
          final theme = Theme.of(element);
          if (theme.brightness != Brightness.dark) {
            problems.add('$screen: theme is not dark');
          }
          final scaffold = element.widget as Scaffold;
          final bg = scaffold.backgroundColor ?? theme.scaffoldBackgroundColor;
          if (bg.computeLuminance() > 0.1) {
            problems.add('$screen: light scaffold background $bg');
          }
        }
        for (final element in find.byType(Card).evaluate()) {
          final color = (element.widget as Card).color;
          if (color != null && color.computeLuminance() > 0.3) {
            problems.add('$screen: light card $color');
          }
        }
      });

      expect(problems, isEmpty, reason: problems.join('\n'));
    });

    testWidgets('text stays legible on every screen in dark mode',
        (tester) async {
      await bootSignedIn(tester, theme: ThemeMode.dark);
      final problems = <String>{};

      await walkScreens(tester, (screen) {
        for (final element in find.byType(RichText).evaluate()) {
          final widget = element.widget as RichText;
          final text = widget.text.toPlainText().trim();
          final color = widget.text.style?.color;
          if (text.isEmpty || color == null || color.a == 0) continue;
          // Icon glyphs are judged by eye, and disabled controls are exempt
          // from contrast rules.
          if (widget.text.style?.fontFamily == 'MaterialIcons') continue;
          if (_isInDisabledButton(element)) continue;
          final bg = _backgroundBehind(element);
          final ratio = _contrast(color, bg);
          if (ratio < 3.0) {
            problems.add('$screen: "${_short(text)}" '
                'contrast ${ratio.toStringAsFixed(2)} '
                '(text $color on $bg)');
          }
        }
      });

      expect(problems, isEmpty, reason: problems.join('\n'));
    });
  });
}

// -----------------------------------------------------------------------------
// Colour helpers
// -----------------------------------------------------------------------------

/// The nearest opaque-ish fill painted behind [element].
Color _backgroundBehind(Element element) {
  Color? found;
  element.visitAncestorElements((ancestor) {
    final widget = ancestor.widget;
    Color? color;
    if (widget is Material && widget.type != MaterialType.transparency) {
      color = widget.color ?? Theme.of(ancestor).colorScheme.surface;
    } else if (widget is DecoratedBox) {
      final decoration = widget.decoration;
      if (decoration is BoxDecoration) color = decoration.color;
      if (decoration is ShapeDecoration) color = decoration.color;
    } else if (widget is ColoredBox) {
      color = widget.color;
    } else if (widget is Scaffold) {
      color = widget.backgroundColor ??
          Theme.of(ancestor).scaffoldBackgroundColor;
    }
    if (color != null && color.a >= 0.6) {
      found = color;
      return false;
    }
    return true;
  });
  return found ?? Theme.of(element).scaffoldBackgroundColor;
}

bool _isInDisabledButton(Element element) {
  var disabled = false;
  element.visitAncestorElements((ancestor) {
    final widget = ancestor.widget;
    if (widget is ButtonStyleButton) {
      disabled = !widget.enabled;
      return false;
    }
    return true;
  });
  return disabled;
}

double _contrast(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  final hi = la > lb ? la : lb;
  final lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

String _short(String text) =>
    text.length <= 40 ? text : '${text.substring(0, 40)}…';
