import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();

  final _fullNameController = TextEditingController();
  final _ninController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  final _ninFocus = FocusNode();
  final _emailFocus = FocusNode();
  final _phoneFocus = FocusNode();
  final _passwordFocus = FocusNode();
  final _confirmPasswordFocus = FocusNode();

  bool _obscurePassword = true;
  bool _obscureConfirmPassword = true;
  bool _agreedToTerms = false;

  @override
  void dispose() {
    _fullNameController.dispose();
    _ninController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    _ninFocus.dispose();
    _emailFocus.dispose();
    _phoneFocus.dispose();
    _passwordFocus.dispose();
    _confirmPasswordFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    // Clear any lingering API error before re-validating
    context.read<AuthProvider>().clearError();

    if (!_formKey.currentState!.validate()) return;

    if (!_agreedToTerms) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please agree to the Terms & Conditions to continue.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }

    final auth = context.read<AuthProvider>();
    final success = await auth.register(
      fullName: _fullNameController.text.trim(),
      nin: _ninController.text.trim(),
      email: _emailController.text.trim(),
      password: _passwordController.text,
      phone: _phoneController.text.trim().isEmpty
          ? null
          : _phoneController.text.trim(),
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
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: AppConstants.spacingXl),

                // Header row — icon + title/subtitle
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: const BoxDecoration(
                        color: AppColors.primaryLight,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.shield_outlined,
                        size: 22,
                        color: AppColors.primary,
                      ),
                    ),
                    const SizedBox(width: AppConstants.spacingMd),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Create Account',
                            style: AppTextStyles.heading2,
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Join to start building a functional Nigeria.',
                            style: AppTextStyles.bodySmall.copyWith(
                              color: AppColors.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: AppConstants.spacingXl),

                // Error banner
                Consumer<AuthProvider>(
                  builder: (_, auth, __) {
                    if (auth.errorMessage == null) {
                      return const SizedBox.shrink();
                    }
                    return Padding(
                      padding:
                          const EdgeInsets.only(bottom: AppConstants.spacingMd),
                      child: ErrorBanner(message: auth.errorMessage!),
                    );
                  },
                ),

                // Full Name
                AppTextField(
                  controller: _fullNameController,
                  label: 'Full Name',
                  hint: 'e.g. Adaeze Okafor',
                  keyboardType: TextInputType.name,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.name],
                  prefixIcon: const Icon(Icons.person_outline_rounded),
                  onChanged: (_) => context.read<AuthProvider>().clearError(),
                  onFieldSubmitted: (_) =>
                      FocusScope.of(context).requestFocus(_ninFocus),
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) {
                      return 'Full name is required';
                    }
                    if (v.trim().split(' ').length < 2) {
                      return 'Please enter your first and last name';
                    }
                    return null;
                  },
                ),

                const SizedBox(height: AppConstants.spacingMd),

                // NIN
                AppTextField(
                  controller: _ninController,
                  label: 'NIN (National Identification Number)',
                  hint: 'Enter your 11-digit NIN',
                  focusNode: _ninFocus,
                  keyboardType: TextInputType.number,
                  textInputAction: TextInputAction.next,
                  maxLength: 11,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  prefixIcon: const Icon(Icons.tag_rounded),
                  onChanged: (_) => context.read<AuthProvider>().clearError(),
                  onFieldSubmitted: (_) =>
                      FocusScope.of(context).requestFocus(_emailFocus),
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) {
                      return 'NIN is required';
                    }
                    if (!RegExp(r'^\d{11}$').hasMatch(v.trim())) {
                      return 'NIN must be exactly 11 digits';
                    }
                    return null;
                  },
                ),

                const SizedBox(height: AppConstants.spacingMd),

                // Email
                AppTextField(
                  controller: _emailController,
                  label: 'Email Address',
                  hint: 'e.g. adaeze@domain.ng',
                  focusNode: _emailFocus,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.email],
                  prefixIcon: const Icon(Icons.mail_outline_rounded),
                  onChanged: (_) => context.read<AuthProvider>().clearError(),
                  onFieldSubmitted: (_) =>
                      FocusScope.of(context).requestFocus(_phoneFocus),
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

                // Phone (optional)
                AppTextField(
                  controller: _phoneController,
                  label: 'Phone Number',
                  hint: 'e.g. +234 803 123 4567',
                  focusNode: _phoneFocus,
                  keyboardType: TextInputType.phone,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.telephoneNumber],
                  prefixIcon: const Icon(Icons.phone_outlined),
                  onChanged: (_) => context.read<AuthProvider>().clearError(),
                  onFieldSubmitted: (_) =>
                      FocusScope.of(context).requestFocus(_passwordFocus),
                  // Phone is optional — no required validator
                  validator: (v) {
                    if (v != null && v.trim().isNotEmpty) {
                      if (!RegExp(r'^\+?[\d\s\-]{7,15}$').hasMatch(v.trim())) {
                        return 'Enter a valid phone number';
                      }
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
                  focusNode: _passwordFocus,
                  obscureText: _obscurePassword,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.newPassword],
                  prefixIcon: const Icon(Icons.lock_outline_rounded),
                  onChanged: (_) => context.read<AuthProvider>().clearError(),
                  onFieldSubmitted: (_) => FocusScope.of(context)
                      .requestFocus(_confirmPasswordFocus),
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
                    if (v.length < 8) {
                      return 'Password must be at least 8 characters';
                    }
                    return null;
                  },
                ),

                const SizedBox(height: AppConstants.spacingMd),

                // Confirm Password
                AppTextField(
                  controller: _confirmPasswordController,
                  label: 'Confirm Password',
                  hint: '••••••••',
                  focusNode: _confirmPasswordFocus,
                  obscureText: _obscureConfirmPassword,
                  textInputAction: TextInputAction.done,
                  autofillHints: const [AutofillHints.newPassword],
                  prefixIcon: const Icon(Icons.lock_outline_rounded),
                  onChanged: (_) => context.read<AuthProvider>().clearError(),
                  onFieldSubmitted: (_) => _submit(),
                  suffixIcon: IconButton(
                    icon: Icon(
                      _obscureConfirmPassword
                          ? Icons.visibility_off_outlined
                          : Icons.visibility_outlined,
                    ),
                    onPressed: () => setState(() =>
                        _obscureConfirmPassword = !_obscureConfirmPassword),
                  ),
                  validator: (v) {
                    if (v == null || v.isEmpty) {
                      return 'Please confirm your password';
                    }
                    if (v != _passwordController.text) {
                      return 'Passwords do not match';
                    }
                    return null;
                  },
                ),

                const SizedBox(height: AppConstants.spacingLg),

                // Terms & Conditions checkbox
                _TermsCheckbox(
                  value: _agreedToTerms,
                  onChanged: (v) => setState(() => _agreedToTerms = v ?? false),
                ),

                const SizedBox(height: AppConstants.spacingLg),

                // Create Account button
                Consumer<AuthProvider>(
                  builder: (_, auth, __) => PrimaryButton(
                    label: 'Create Account',
                    isLoading: auth.isLoading,
                    onPressed: _submit,
                  ),
                ),

                const SizedBox(height: AppConstants.spacingLg),

                // Already have an account? Sign In
                Center(
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        'Already have an account? ',
                        style: AppTextStyles.bodyMedium,
                      ),
                      GestureDetector(
                        onTap: () => context.pop(),
                        child: const Text('Sign In', style: AppTextStyles.link),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: AppConstants.spacingXl),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Terms & Conditions checkbox row
// ---------------------------------------------------------------------------

class _TermsCheckbox extends StatelessWidget {
  const _TermsCheckbox({required this.value, required this.onChanged});

  final bool value;
  final ValueChanged<bool?> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 24,
          height: 24,
          child: Checkbox(
            value: value,
            onChanged: onChanged,
            visualDensity: VisualDensity.compact,
          ),
        ),
        const SizedBox(width: AppConstants.spacingSm),
        Expanded(
          child: GestureDetector(
            onTap: () => onChanged(!value),
            child: RichText(
              text: const TextSpan(
                style: AppTextStyles.bodySmall,
                children: [
                  TextSpan(text: 'I agree to the '),
                  TextSpan(
                      text: 'Terms & Conditions', style: AppTextStyles.link),
                  TextSpan(text: ' and '),
                  TextSpan(text: 'Privacy Policy', style: AppTextStyles.link),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
