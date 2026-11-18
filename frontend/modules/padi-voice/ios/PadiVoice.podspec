Pod::Spec.new do |s|
  s.name = 'PadiVoice'
  s.version = '1.0.0'
  s.summary = 'PADI foreground echo-cancelled voice capture'
  s.description = s.summary
  s.license = { :type => 'UNLICENSED' }
  s.author = 'My PADI'
  s.homepage = 'https://mypadi.app'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
