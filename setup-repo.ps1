# One-time setup: makes this folder a git repo under YOUR identity and pushes it to a private
# GitHub repo in your personal account (Vercel Hobby only deploys the owner's commits).
# Run in this folder:  powershell -ExecutionPolicy Bypass -File .\setup-repo.ps1

$ErrorActionPreference = 'Continue'  # check exit codes by hand (PS 5.1 treats native stderr as errors)
$RepoName = 'joud-bird-vr'
Set-Location -Path $PSScriptRoot

function Fail($msg) { Write-Host "X $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "OK $msg" -ForegroundColor Green }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'Git is not installed: https://git-scm.com/download/win' }

$name = (git config --global user.name) 2>$null
$email = (git config --global user.email) 2>$null
if (-not $name -or -not $email) {
  Fail 'Set your git identity first (use the email on your GitHub account):
  git config --global user.name  "Your Name"
  git config --global user.email "you@example.com"'
}
Ok "Committing as $name <$email>"

if (-not (Test-Path '.git')) {
  git init -b main | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'git init failed' }
  Ok 'Initialised repo on branch main'
} else {
  Ok 'Repo already initialised'
}

git add -A
$pending = git status --porcelain
if ($pending) {
  git commit -m "chore: repo foundation (agent rules, spec, plan, prompts, Joud model)" | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'git commit failed' }
  Ok 'First commit created'
} else {
  Ok 'Nothing new to commit'
}

$hasRemote = (git remote) -contains 'origin'
if ($hasRemote) { Ok 'Remote origin already set'; git push -u origin main; exit 0 }

if (Get-Command gh -ErrorAction SilentlyContinue) {
  gh auth status 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    gh repo create $RepoName --private --source . --remote origin --push
    if ($LASTEXITCODE -ne 0) { Fail 'gh repo create failed (does the repo already exist?)' }
    Ok "Pushed to private repo $RepoName"
    exit 0
  }
  Write-Host 'gh is installed but not logged in. Run: gh auth login, then run this script again.' -ForegroundColor Yellow
  exit 1
}

Write-Host @"
GitHub CLI not found. Finish by hand:
  1. Create an EMPTY private repo named $RepoName in your personal GitHub account
     (no README, no .gitignore, no licence).
  2. Run:
     git remote add origin https://github.com/<your-username>/$RepoName.git
     git push -u origin main
"@ -ForegroundColor Yellow
