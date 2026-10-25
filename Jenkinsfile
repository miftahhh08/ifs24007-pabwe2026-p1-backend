// Pipeline Jenkins untuk repo BACKEND GulaSadar: install -> test -> (opsional) deploy.
pipeline {
  agent any
  options { timestamps(); timeout(time: 15, unit: 'MINUTES') }
  environment { PATH = "${env.HOME}/.bun/bin:${env.PATH}" }
  stages {
    stage('Install Bun') {
      steps { sh 'command -v bun || curl -fsSL https://bun.sh/install | bash; bun --version' }
    }
    stage('Install dependencies') {
      steps { sh 'bun install --frozen-lockfile' }
    }
    stage('Test') {
      steps { sh 'bun run test' }
    }
    stage('Build image') {
      when { branch 'main' }
      steps { sh 'docker build -t gulasadar-backend:${BUILD_NUMBER} .' }
    }
    stage('Deploy') {
      when { branch 'main' }
      steps { echo 'Deploy: docker compose up -d --build (lihat README).' }
    }
  }
  post {
    always { archiveArtifacts artifacts: 'coverage/lcov.info', allowEmptyArchive: true }
    success { echo 'Pipeline backend sukses' }
    failure { echo 'Pipeline backend gagal, periksa log tahap yang merah' }
  }
}
