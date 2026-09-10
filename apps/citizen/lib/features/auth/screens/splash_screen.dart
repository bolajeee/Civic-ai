import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_text_styles.dart';
import '../providers/auth_provider.dart';
import '../../../core/router/app_router.dart';

/// Splash screen — dark green background, shield icon, brand name, tagline.
///
/// Listens to [AuthProvider.status]:
///   - [AuthStatus.initializing] → stays on splash while session is being restored
///   - [AuthStatus.authenticated] → navigates to home
///   - [AuthStatus.unauthenticated] → navigates to login
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _fadeIn;
  late final Animation<double> _scaleIn;

  @override
  void initState() {
    super.initState();

    // Force the status bar to be light-on-dark for the green background
    SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
    ));

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );

    _fadeIn = CurvedAnimation(parent: _controller, curve: Curves.easeIn);
    _scaleIn = Tween<double>(begin: 0.75, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOutBack),
    );

    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    // Restore dark status bar icons for white screens
    SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
    ));
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        // Navigate once the provider finishes initializing
        if (auth.status == AuthStatus.authenticated) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) context.go(AppRoutes.permissions);
          });
        } else if (auth.status == AuthStatus.unauthenticated) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) context.go(AppRoutes.login);
          });
        }

        return Scaffold(
          backgroundColor: AppColors.primaryDark,
          body: SafeArea(
            child: Center(
              child: FadeTransition(
                opacity: _fadeIn,
                child: ScaleTransition(
                  scale: _scaleIn,
                  child: const _SplashContent(),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _SplashContent extends StatelessWidget {
  const _SplashContent();

  @override
  Widget build(BuildContext context) {
    return const Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Shield icon circle
       _ShieldCircle(),

       SizedBox(height: 24),

        // Brand name
       Text('Civic Report', style: AppTextStyles.splashTitle),

       SizedBox(height: 8),

        // Tagline
       Text(
          'Empowering Citizens. Building Nigeria.',
          style: AppTextStyles.splashTagline,
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}

class _ShieldCircle extends StatelessWidget {
  const _ShieldCircle();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      width: 88,
      height: 88,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: AppColors.iconCircleBg,
          shape: BoxShape.circle,
        ),
        child: Icon(
          Icons.shield_outlined,
          size: 44,
          color: Colors.white,
        ),
      ),
    );
  }
}
