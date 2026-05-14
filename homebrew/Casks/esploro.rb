cask "esploro" do
  version "0.4.6"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/matija/esploro/releases/download/v#{version}/Esploro_#{version}_aarch64.dmg"
  name "Esploro"
  desc "A fast PostgreSQL and MySQL client"
  homepage "https://github.com/matija/esploro"

  app "Esploro.app"
end
