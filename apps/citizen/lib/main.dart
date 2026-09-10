import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/providers/auth_provider.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Lock to portrait orientation
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  runApp(const CivicReportApp());
}

class CivicReportApp extends StatefulWidget {
  const CivicReportApp({super.key});

  @override
  State<CivicReportApp> createState() => _CivicReportAppState();
}

class _CivicReportAppState extends State<CivicReportApp> {
  // AuthProvider is created here so the router can hold a stable reference
  // to the same instance across rebuilds.
  late final AuthProvider _authProvider;

  @override
  void initState() {
    super.initState();
    _authProvider = AuthProvider();
  }

  @override
  void dispose() {
    _authProvider.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: _authProvider),
      ],
      child: _AppView(authProvider: _authProvider),
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
  // Router is built once and held here — not recreated on rebuild.
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
