import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_text_styles.dart';

/// Splash screen — dark green background, shield icon, brand name, tagline.
///
/// Navigation is handled entirely by [GoRouter]'s redirect callback, which
/// listens to [AuthProvider] via [refreshListenable]. This screen only owns
/// its animation — it never calls [context.go] itself.
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
    SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
    ));
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // No Consumer / navigation logic here — the router redirect handles
    // moving away from splash once AuthProvider.status changes.
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
