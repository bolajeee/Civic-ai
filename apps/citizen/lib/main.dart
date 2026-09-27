import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/providers/auth_provider.dart';
import 'features/report/providers/report_draft_provider.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Create the provider BEFORE runApp so the instance is ready.
  // initialize() is called AFTER runApp — by that point GoRouter has mounted
  // and subscribed to the ChangeNotifier via refreshListenable, so the
  // notifyListeners() inside initialize() reliably triggers the redirect.
  final authProvider = AuthProvider();

  runApp(CivicReportApp(authProvider: authProvider));

  // Kick off session restore now that the widget tree is listening.
  authProvider.initialize();
}

class CivicReportApp extends StatelessWidget {
  const CivicReportApp({super.key, required this.authProvider});

  final AuthProvider authProvider;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: authProvider),
        // Owns the in-progress report. Registered app-wide so a draft survives
        // navigation within the report flow; ReportIssueScreen resets it on
        // entry, so leaving the form discards the staged photos.
        ChangeNotifierProvider<ReportDraftProvider>(
          create: (_) => ReportDraftProvider(),
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
    return MaterialApp.router(
      title: 'Civic Report',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      routerConfig: router,
    );
  }
}
