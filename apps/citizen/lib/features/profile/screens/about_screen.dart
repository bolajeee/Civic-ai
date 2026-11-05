import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('About')),
        body: FutureBuilder<PackageInfo>(
          future: PackageInfo.fromPlatform(),
          builder: (context, snapshot) {
            final info = snapshot.data;
            final version = info == null
                ? 'Loading…'
                : 'Version ${info.version} (${info.buildNumber})';
            return ListView(
              padding: const EdgeInsets.all(24),
              children: [
                Icon(Icons.shield_outlined,
                    size: 64, color: Theme.of(context).colorScheme.primary),
                const SizedBox(height: 16),
                Text('Civic Report',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 8),
                Text(version, textAlign: TextAlign.center),
                const SizedBox(height: 24),
                const Text(
                    'CivicAI helps citizens document local infrastructure issues and follow their progress from submission to resolution.',
                    textAlign: TextAlign.center),
                const SizedBox(height: 24),
                const Text('© 2026 CivicAI', textAlign: TextAlign.center),
              ],
            );
          },
        ),
      );
}
