import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../../../core/errors/api_exception.dart';
import '../../../core/router/app_router.dart';
import '../../../shared/widgets/app_text_field.dart';
import '../../../shared/widgets/error_banner.dart';
import '../../../shared/widgets/primary_button.dart';
import '../services/auth_service.dart';

class ResetPasswordScreen extends StatefulWidget {
  const ResetPasswordScreen({super.key, this.initialEmail});
  final String? initialEmail;

  @override
  State<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends State<ResetPasswordScreen> {
  final _requestKey = GlobalKey<FormState>();
  final _resetKey = GlobalKey<FormState>();
  late final TextEditingController _emailController;
  final _codeController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _codeSent = false;
  bool _loading = false;
  bool _obscurePassword = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _emailController = TextEditingController(text: widget.initialEmail ?? '');
  }

  @override
  void dispose() {
    _emailController.dispose();
    _codeController.dispose();
    _passwordController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _requestCode() async {
    final form = _requestKey.currentState;
    if (form != null && !form.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final debugCode = await AuthService.instance.requestPasswordReset(
        email: _emailController.text.trim(),
      );
      if (!mounted) return;
      setState(() {
        _codeSent = true;
        if (debugCode != null) _codeController.text = debugCode;
      });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(debugCode == null
            ? 'If that account exists, a reset code was sent.'
            : 'Development reset code filled in automatically.'),
        behavior: SnackBarBehavior.floating,
      ));
    } on DioException catch (e) {
      if (mounted) {
        setState(() => _error = ApiException.fromDio(e).message);
      }
    } catch (_) {
      if (mounted) {
        setState(
            () => _error = 'Unable to request a reset code. Please try again.');
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _resetPassword() async {
    if (!_resetKey.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await AuthService.instance.resetPassword(
        email: _emailController.text.trim(),
        code: _codeController.text.trim(),
        password: _passwordController.text,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Password reset. Sign in with your new password.'),
        behavior: SnackBarBehavior.floating,
      ));
      context.go(AppRoutes.login);
    } on DioException catch (e) {
      if (mounted) {
        setState(() => _error = ApiException.fromDio(e).message);
      }
    } catch (_) {
      if (mounted) {
        setState(
            () => _error = 'Unable to reset the password. Please try again.');
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      appBar: AppBar(title: const Text('Reset password')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppConstants.spacingLg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: AppConstants.spacingMd),
              const Text('Recover your account', style: AppTextStyles.heading1),
              const SizedBox(height: AppConstants.spacingSm),
              Text(
                _codeSent
                    ? 'Enter the six-digit code and choose a new password.'
                    : 'We will send a six-digit code to your account email.',
                style: AppTextStyles.bodyMedium,
              ),
              const SizedBox(height: AppConstants.spacingLg),
              if (_error != null) ...[
                ErrorBanner(message: _error!),
                const SizedBox(height: AppConstants.spacingMd),
              ],
              if (!_codeSent) _buildRequestForm() else _buildResetForm(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRequestForm() => Form(
        key: _requestKey,
        child: Column(children: [
          AppTextField(
            controller: _emailController,
            label: 'Email Address',
            hint: 'e.g. adaeze@domain.ng',
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.email],
            prefixIcon: const Icon(Icons.mail_outline_rounded),
            onFieldSubmitted: (_) => _requestCode(),
            validator: _validateEmail,
          ),
          const SizedBox(height: AppConstants.spacingLg),
          PrimaryButton(
              label: 'Send Reset Code',
              isLoading: _loading,
              onPressed: _requestCode),
        ]),
      );

  Widget _buildResetForm() => Form(
        key: _resetKey,
        child: Column(children: [
          AppTextField(
            controller: _codeController,
            label: 'Reset Code',
            hint: '000000',
            keyboardType: TextInputType.number,
            textInputAction: TextInputAction.next,
            maxLength: 6,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            prefixIcon: const Icon(Icons.pin_outlined),
            validator: (value) =>
                value?.length == 6 ? null : 'Enter the six-digit reset code',
          ),
          const SizedBox(height: AppConstants.spacingMd),
          AppTextField(
            controller: _passwordController,
            label: 'New Password',
            hint: 'At least 8 characters',
            obscureText: _obscurePassword,
            textInputAction: TextInputAction.next,
            autofillHints: const [AutofillHints.newPassword],
            prefixIcon: const Icon(Icons.lock_outline_rounded),
            suffixIcon: IconButton(
              onPressed: () =>
                  setState(() => _obscurePassword = !_obscurePassword),
              icon: Icon(_obscurePassword
                  ? Icons.visibility_off_outlined
                  : Icons.visibility_outlined),
            ),
            validator: (value) => (value?.length ?? 0) >= 8
                ? null
                : 'Password must be at least 8 characters',
          ),
          const SizedBox(height: AppConstants.spacingMd),
          AppTextField(
            controller: _confirmController,
            label: 'Confirm New Password',
            hint: 'Repeat your new password',
            obscureText: true,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.newPassword],
            prefixIcon: const Icon(Icons.lock_reset_rounded),
            onFieldSubmitted: (_) => _resetPassword(),
            validator: (value) => value == _passwordController.text
                ? null
                : 'Passwords do not match',
          ),
          const SizedBox(height: AppConstants.spacingLg),
          PrimaryButton(
              label: 'Reset Password',
              isLoading: _loading,
              onPressed: _resetPassword),
          TextButton(
            onPressed: _loading ? null : _requestCode,
            child: const Text('Send a new code'),
          ),
        ]),
      );

  String? _validateEmail(String? value) {
    final email = value?.trim() ?? '';
    if (email.isEmpty) return 'Email is required';
    if (!RegExp(r'^[^@]+@[^@]+\.[^@]+$').hasMatch(email)) {
      return 'Enter a valid email address';
    }
    return null;
  }
}
