import Foundation

/// Public project settings (the same publishable key the web app ships with).
enum CrooConfig {
    static let supabaseURL = "https://lmodeiyrpwvgyqcvjkjr.supabase.co"
    static let anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxtb2RlaXlycHd2Z3lxY3Zqa2pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MTIyODYsImV4cCI6MjA3OTQ4ODI4Nn0.h2MYYJ3CQh6mEF5sWsRY_tttuZCv_8WOKjnTvnHaChg"
    static let deviceServiceURL = supabaseURL + "/functions/v1/watch-device-service"
    static let webBase = "https://croohq.com"
}
