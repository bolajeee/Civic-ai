plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.example.civic_report"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.example.civic_report"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        // 24 is the floor for the resolved plugin set, and it comes from the
        // three plugins that pin a literal rather than deferring to Flutter's
        // baseline: image_picker_android 0.8.13+23, shared_preferences_android
        // 2.4.28 and url_launcher_android 6.3.33 all declare `minSdk = 24`.
        // Asking for less fails the manifest merger, not the Dart build, so it
        // only shows up here.
        //
        // Everything else sits lower and is not the constraint:
        // permission_handler_android and flutter_secure_storage declare 19,
        // geocoding_android 16. geolocator_android declares no number at all —
        // it inherits `flutter.minSdkVersion`, which 24 satisfies.
        //
        // This was 18, which flutter_secure_storage alone was happy with.
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
