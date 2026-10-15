import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/providers/app_settings_provider.dart';
import 'features/auth/providers/auth_provider.dart';
import 'features/report/providers/report_draft_provider.dart';
import 'features/report/providers/report_history_provider.dart';
import 'features/report/providers/report_summary_provider.dart';
import 'features/report/providers/report_sync_provider.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // Create the provider BEFORE runApp so the instance is ready.
  // initialize() is called AFTER runApp — by that point GoRouter has mounted
  // and subscribed to the ChangeNotifier via refreshListenable, so the
  // notifyListeners() inside initialize() reliably triggers the redirect.
  final authProvider = AuthProvider();
  final settingsProvider = AppSettingsProvider();

  runApp(CivicReportApp(
    authProvider: authProvider,
    settingsProvider: settingsProvider,
  ));

  // Platform channels can be slow while a fresh emulator is starting. Do not
  // hold the first Flutter frame behind them: render the splash screen first,
  // then restore preferences and the session in the background.
  unawaited(SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]));
  unawaited(settingsProvider.initialize());
  unawaited(authProvider.initialize());
}

class CivicReportApp extends StatelessWidget {
  const CivicReportApp({
    super.key,
    required this.authProvider,
    required this.settingsProvider,
  });

  final AuthProvider authProvider;
  final AppSettingsProvider settingsProvider;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: authProvider),
        ChangeNotifierProvider<AppSettingsProvider>.value(
          value: settingsProvider,
        ),
        ChangeNotifierProxyProvider<AuthProvider, ReportSummaryProvider>(
          create: (_) => ReportSummaryProvider(),
          update: (_, auth, summary) =>
              summary!..setCitizen(auth.isAuthenticated ? auth.user?.id : null),
        ),
        // Owns the in-progress report. Registered app-wide so the form and its
        // fields share one draft; ReportScreen resets it on entry, so leaving
        // the form discards the staged photos.
        ChangeNotifierProxyProvider<AuthProvider, ReportDraftProvider>(
          create: (_) => ReportDraftProvider(),
          update: (_, auth, draft) =>
              draft!..setCitizen(auth.isAuthenticated ? auth.user?.id : null),
        ),
        ChangeNotifierProxyProvider<AuthProvider, ReportSyncProvider>(
          create: (_) => ReportSyncProvider(),
          update: (_, auth, sync) =>
              sync!..setCitizen(auth.isAuthenticated ? auth.user?.id : null),
        ),
        // Owns the report history. Registered here rather than on the history
        // screen so the list survives navigation and is already loaded when the
        // citizen returns to it after submitting.
        ChangeNotifierProvider<ReportHistoryProvider>(
          create: (_) => ReportHistoryProvider(),
        ),
      ],
      child: _AppView(authProvider: authProvider),
    );
  }
}

class _AppView extends StatefulWidget {
  const _AppView({required this.authProvider});
  final AuthProvider authProvider;

  @override
  State<_AppView> createState() => _AppViewState();
}

class _AppViewState extends State<_AppView> {
  // Router is built once — not recreated on rebuild.
  late final router = buildRouter(widget.authProvider);

  @override
  Widget build(BuildContext context) {
    final settings = context.watch<AppSettingsProvider>();
    return MaterialApp.router(
      title: 'Civic Report',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: settings.themeMode,
      locale: settings.locale,
      routerConfig: router,
    );
  }
}
