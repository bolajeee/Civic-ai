import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../../../core/router/app_router.dart';
import '../../../shared/widgets/app_text_field.dart';
import '../../../shared/widgets/error_banner.dart';
import '../../../shared/widgets/primary_button.dart';
import '../providers/auth_provider.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _passwordFocus = FocusNode();

  bool _obscurePassword = true;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    final auth = context.read<AuthProvider>();
    final success = await auth.login(
      email: _emailController.text.trim(),
      password: _passwordController.text,
    );

    if (success && mounted) {
      context.go(AppRoutes.permissions);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(
            horizontal: AppConstants.spacingLg,
          ),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                const SizedBox(height: AppConstants.spacingXxl),

                // Shield icon
                Container(
                  width: 60,
                  height: 60,
                  decoration: const BoxDecoration(
                    color: AppColors.primaryLight,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.shield_outlined,
                    size: 30,
                    color: AppColors.primary,
                  ),
                ),

                const SizedBox(height: AppConstants.spacingLg),

                // Heading
                const Text('Welcome Back', style: AppTextStyles.heading1),

                const SizedBox(height: AppConstants.spacingSm),

                const Text(
                  'Sign in to report and track infrastructure issues',
                  style: AppTextStyles.bodyMedium,
                  textAlign: TextAlign.center,
                ),

                const SizedBox(height: AppConstants.spacingXl),

                // Error banner
                Consumer<AuthProvider>(
                  builder: (_, auth, __) {
                    if (auth.errorMessage == null){
                      return const SizedBox.shrink();}
                    return Padding(
                      padding:
                          const EdgeInsets.only(bottom: AppConstants.spacingMd),
                      child: ErrorBanner(message: auth.errorMessage!),
                    );
                  },
                ),

                // Email
                AppTextField(
                  controller: _emailController,
                  label: 'Email Address',
                  hint: 'e.g. adaeze@domain.ng',
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.email],
                  prefixIcon: const Icon(Icons.mail_outline_rounded),
                  onChanged: (_) => context.read<AuthProvider>().clearError(),
                  onFieldSubmitted: (_) =>
                      FocusScope.of(context).requestFocus(_passwordFocus),
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) {
                      return 'Email is required';
                    }
                    if (!RegExp(r'^[^@]+@[^@]+\.[^@]+').hasMatch(v.trim())) {
                      return 'Enter a valid email address';
                    }
                    return null;
                  },
                ),

                const SizedBox(height: AppConstants.spacingMd),

                // Password
                AppTextField(
                  controller: _passwordController,
                  label: 'Password',
                  hint: '••••••••',
                  obscureText: _obscurePassword,
                  focusNode: _passwordFocus,
                  textInputAction: TextInputAction.done,
                  autofillHints: const [AutofillHints.password],
                  prefixIcon: const Icon(Icons.lock_outline_rounded),
                  onChanged: (_) => context.read<AuthProvider>().clearError(),
                  onFieldSubmitted: (_) => _submit(),
                  suffixIcon: IconButton(
                    icon: Icon(
                      _obscurePassword
                          ? Icons.visibility_off_outlined
                          : Icons.visibility_outlined,
                    ),
                    onPressed: () =>
                        setState(() => _obscurePassword = !_obscurePassword),
                  ),
                  validator: (v) {
                    if (v == null || v.isEmpty) return 'Password is required';
                    return null;
                  },
                ),

                // Forgot password
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () {
                      // Forgot password flow — Phase 6 (Hardening)
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Password reset coming soon.'),
                          behavior: SnackBarBehavior.floating,
                        ),
                      );
                    },
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(
                        vertical: AppConstants.spacingSm,
                      ),
                    ),
                    child: const Text(
                      'Forgot Password?',
                      style: AppTextStyles.link,
                    ),
                  ),
                ),

                const SizedBox(height: AppConstants.spacingSm),

                // Sign in button
                Consumer<AuthProvider>(
                  builder: (_, auth, __) => PrimaryButton(
                    label: 'Sign In',
                    isLoading: auth.isLoading,
                    onPressed: _submit,
                  ),
                ),

                const SizedBox(height: AppConstants.spacingLg),

                // OR divider
                const _OrDivider(),

                const SizedBox(height: AppConstants.spacingLg),

                // Continue with Google
                _SocialButton(
                  label: 'Continue with Google',
                  icon: _GoogleIcon(),
                  onPressed: () {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Google sign-in coming soon.'),
                        behavior: SnackBarBehavior.floating,
                      ),
                    );
                  },
                ),

                const SizedBox(height: AppConstants.spacingMd),

                // Continue with Apple
                _SocialButton(
                  label: 'Continue with Apple',
                  icon: const Icon(Icons.apple,
                      size: 20, color: AppColors.textPrimary),
                  onPressed: () {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Apple sign-in coming soon.'),
                        behavior: SnackBarBehavior.floating,
                      ),
                    );
                  },
                ),

                const SizedBox(height: AppConstants.spacingXxl),

                // Sign up link
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      "Don't have an account? ",
                      style: AppTextStyles.bodyMedium,
                    ),
                    GestureDetector(
                      onTap: () => context.push(AppRoutes.register),
                      child: const Text('Sign Up', style: AppTextStyles.link),
                    ),
                  ],
                ),

                const SizedBox(height: AppConstants.spacingLg),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// OR divider
// ---------------------------------------------------------------------------

class _OrDivider extends StatelessWidget {
  const _OrDivider();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Expanded(child: Divider()),
        Padding(
          padding:
              const EdgeInsets.symmetric(horizontal: AppConstants.spacingMd),
          child: Text(
            'OR',
            style: AppTextStyles.bodySmall.copyWith(
              color: AppColors.textSecondary,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
        const Expanded(child: Divider()),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Social login button
// ---------------------------------------------------------------------------

class _SocialButton extends StatelessWidget {
  const _SocialButton({
    required this.label,
    required this.icon,
    required this.onPressed,
  });

  final String label;
  final Widget icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: AppConstants.inputHeight,
      child: OutlinedButton(
        onPressed: onPressed,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            icon,
            const SizedBox(width: AppConstants.spacingSm),
            Text(label, style: AppTextStyles.label),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Google icon (painted, no dependency needed)
// ---------------------------------------------------------------------------

class _GoogleIcon extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 20,
      height: 20,
      child: CustomPaint(painter: _GooglePainter()),
    );
  }
}

class _GooglePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromLTWH(0, 0, size.width, size.height);
    final center = rect.center;
    final radius = size.width / 2;

    // Red arc (top-right)
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -0.35,
      1.75,
      false,
      Paint()
        ..color = const Color(0xFFEA4335)
        ..style = PaintingStyle.stroke
        ..strokeWidth = size.width * 0.18,
    );
    // Blue arc (top-left)
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -2.1,
      1.05,
      false,
      Paint()
        ..color = const Color(0xFF4285F4)
        ..style = PaintingStyle.stroke
        ..strokeWidth = size.width * 0.18,
    );
    // Yellow arc (bottom-left)
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      2.45,
      0.7,
      false,
      Paint()
        ..color = const Color(0xFFFBBC05)
        ..style = PaintingStyle.stroke
        ..strokeWidth = size.width * 0.18,
    );
    // Green arc (bottom-right)
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      3.14,
      0.6,
      false,
      Paint()
        ..color = const Color(0xFF34A853)
        ..style = PaintingStyle.stroke
        ..strokeWidth = size.width * 0.18,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
