import { getNodesByType } from "../graph/engine.js";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { atomicWriteFile } from "../cache/atomic.js";
import { projectPath } from "../security/paths.js";
export function generateCicd(config) {
    const results = [];
    const platforms = config.platform === "all"
        ? ["github", "gitlab", "jenkins", "docker", "circleci", "azure", "aws", "travis", "npm", "compose", "maven", "pip", "go"]
        : [config.platform];
    for (const platform of platforms) {
        const generator = generators[platform];
        if (generator) {
            results.push(generator(config));
        }
    }
    return results;
}
function generateGitHubActions(config) {
    const endpoints = getNodesByType(config.graph, "endpoint");
    const hasApi = endpoints.length > 0;
    const apiSteps = hasApi ? `
      - name: Run API tests
        run: |
          echo "Running API tests for ${endpoints.length} endpoints"
          npm test -- --grep "api"
` : "";
    const content = `name: SDD CI Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  sdd-validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Validate SDD graph
        run: |
          echo "Validating SDD specification..."
          npx opencode-telos validate
        continue-on-error: false

      - name: Check SDD drift
        run: |
          echo "Checking specification drift..."
          npx opencode-telos drift
        continue-on-error: true

      - name: Check SDD quality
        run: |
          echo "Checking SDD quality score..."
          npx opencode-telos quality
        continue-on-error: true

      - name: Detect anti-patterns
        run: |
          echo "Detecting anti-patterns..."
          npx opencode-telos anti-patterns
        continue-on-error: true

      - name: Check test coverage
        run: |
          echo "Checking test coverage..."
          npx opencode-telos coverage
        continue-on-error: true

      - name: Detect contradictions
        run: |
          echo "Detecting contradictions..."
          npx opencode-telos contradictions
        continue-on-error: true
${apiSteps}
      - name: Build
        run: npm run build

  sdd-deploy:
    needs: sdd-validate
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Deploy
        run: |
          echo "Deploying with SDD validation..."
          npx opencode-telos full-cycle
`;
    const filePath = join(config.projectDir, ".github", "workflows", "sdd-ci.yml");
    return { platform: "GitHub Actions", file_path: filePath, content };
}
function generateGitLabCI(config) {
    const content = `stages:
  - validate
  - test
  - build
  - deploy

sdd-validate:
  stage: validate
  image: node:20
  script:
    - npm ci
    - echo "Validating SDD graph..."
    - npx opencode-telos validate
    - echo "Checking SDD drift..."
    - npx opencode-telos drift || true
    - echo "Checking SDD quality..."
    - npx opencode-telos quality || true
    - echo "Detecting anti-patterns..."
    - npx opencode-telos anti-patterns || true
  allow_failure: false

sdd-test:
  stage: test
  image: node:20
  script:
    - npm ci
    - npm test
  allow_failure: false

sdd-build:
  stage: build
  image: node:20
  script:
    - npm ci
    - npm run build
  only:
    - main
    - develop

sdd-deploy:
  stage: deploy
  image: node:20
  script:
    - echo "Deploying with SDD validation..."
    - npx opencode-telos full-cycle
  only:
    - main
  when: manual
`;
    const filePath = join(config.projectDir, ".gitlab-ci.yml");
    return { platform: "GitLab CI", file_path: filePath, content };
}
function generateJenkins(config) {
    const content = `pipeline {
    agent any

    stages {
        stage('SDD Validate') {
            steps {
                script {
                    echo "Validating SDD graph..."
                    sh 'npx opencode-telos validate'
                    echo "Checking SDD drift..."
                    sh 'npx opencode-telos drift || true'
                    echo "Checking SDD quality..."
                    sh 'npx opencode-telos quality || true'
                    echo "Detecting anti-patterns..."
                    sh 'npx opencode-telos anti-patterns || true'
                }
            }
        }

        stage('Test') {
            steps {
                sh 'npm test'
            }
        }

        stage('Build') {
            steps {
                sh 'npm run build'
            }
        }

        stage('Deploy') {
            when {
                branch 'main'
            }
            steps {
                script {
                    echo "Deploying with SDD validation..."
                    sh 'npx opencode-telos full-cycle'
                }
            }
        }
    }

    post {
        always {
            echo "SDD pipeline completed"
        }
        success {
            echo "SDD pipeline succeeded"
        }
        failure {
            echo "SDD pipeline failed"
        }
    }
}
`;
    const filePath = join(config.projectDir, "Jenkinsfile");
    return { platform: "Jenkins", file_path: filePath, content };
}
function generateDocker(config) {
    const content = `# Multi-stage build for SDD-validated project
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Run SDD validation before build
RUN npx opencode-telos validate || echo "SDD validation skipped in Docker"

# Build application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "dist/index.js"]
`;
    const filePath = join(config.projectDir, "Dockerfile");
    return { platform: "Docker", file_path: filePath, content };
}
function generateCircleCI(config) {
    const content = `version: 2.1

orbs:
  node: circleci/node@5.1
  sdd: circleci/opencode-telos@1.0

executors:
  node-executor:
    docker:
      - image: cimg/node:20.0

jobs:
  sdd-validate:
    executor: node-executor
    steps:
      - checkout
      - node/install-packages
      - run:
          name: Validate SDD graph
          command: npx opencode-telos validate
      - run:
          name: Check SDD drift
          command: npx opencode-telos drift || true
      - run:
          name: Check SDD quality
          command: npx opencode-telos quality || true
      - run:
          name: Detect anti-patterns
          command: npx opencode-telos anti-patterns || true

  test:
    executor: node-executor
    steps:
      - checkout
      - node/install-packages
      - run:
          name: Run tests
          command: npm test

  build:
    executor: node-executor
    steps:
      - checkout
      - node/install-packages
      - run:
          name: Build
          command: npm run build

workflows:
  sdd-pipeline:
    jobs:
      - sdd-validate
      - test:
          requires:
            - sdd-validate
      - build:
          requires:
            - test
          filters:
            branches:
              only: main
`;
    const filePath = join(config.projectDir, ".circleci", "config.yml");
    return { platform: "CircleCI", file_path: filePath, content };
}
function generateAzureDevOps(config) {
    const content = `trigger:
  branches:
    include:
      - main
      - develop

pool:
  vmImage: 'ubuntu-latest'

stages:
- stage: Validate
  displayName: 'SDD Validation'
  jobs:
  - job: SDDValidate
    displayName: 'Validate SDD Graph'
    steps:
    - task: NodeTool@0
      inputs:
        versionSpec: '20.x'
      displayName: 'Install Node.js'
    - script: |
        npm ci
        echo "Validating SDD graph..."
        npx opencode-telos validate
      displayName: 'SDD Validate'
    - script: |
        echo "Checking SDD drift..."
        npx opencode-telos drift || true
      displayName: 'Check Drift'
    - script: |
        echo "Checking SDD quality..."
        npx opencode-telos quality || true
      displayName: 'Check Quality'

- stage: Test
  displayName: 'Run Tests'
  dependsOn: Validate
  jobs:
  - job: Test
    displayName: 'Run Tests'
    steps:
    - task: NodeTool@0
      inputs:
        versionSpec: '20.x'
      displayName: 'Install Node.js'
    - script: |
        npm ci
        npm test
      displayName: 'Run Tests'

- stage: Build
  displayName: 'Build'
  dependsOn: Test
  jobs:
  - job: Build
    displayName: 'Build Application'
    steps:
    - task: NodeTool@0
      inputs:
        versionSpec: '20.x'
      displayName: 'Install Node.js'
    - script: |
        npm ci
        npm run build
      displayName: 'Build'

- stage: Deploy
  displayName: 'Deploy'
  dependsOn: Build
  condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
  jobs:
  - job: Deploy
    displayName: 'Deploy Application'
    steps:
    - script: |
        echo "Deploying with SDD validation..."
        npx opencode-telos full-cycle
      displayName: 'Deploy'
`;
    const filePath = join(config.projectDir, "azure-pipelines.yml");
    return { platform: "Azure DevOps", file_path: filePath, content };
}
function generateAWSCodePipeline(config) {
    const content = `# AWS CodePipeline configuration for SDD-validated project
# This file should be used with AWS CloudFormation or CDK

AWSTemplateFormatVersion: '2010-09-09'
Description: 'SDD CI/CD Pipeline'

Resources:
  SDDPipeline:
    Type: AWS::CodePipeline::Pipeline
    Properties:
      Name: SDD-Pipeline
      RoleArn: !GetAtt PipelineRole.Arn
      ArtifactStore:
        Type: S3
        Location: !Ref ArtifactBucket
      Stages:
        - Name: Source
          Actions:
            - Name: SourceAction
              ActionTypeId:
                Category: Source
                Owner: AWS
                Provider: CodeStarSourceConnection
                Version: '1'
              Configuration:
                ConnectionArn: !Ref GitHubConnection
                FullRepositoryId: !Ref RepositoryId
                BranchName: main
              OutputArtifacts:
                - Name: SourceOutput

        - Name: Validate
          Actions:
            - Name: SDDValidate
              ActionTypeId:
                Category: Build
                Owner: AWS
                Provider: CodeBuild
                Version: '1'
              Configuration:
                ProjectName: !Ref SDDValidateProject
              InputArtifacts:
                - Name: SourceOutput
              OutputArtifacts:
                - Name: ValidateOutput

        - Name: Test
          Actions:
            - Name: Test
              ActionTypeId:
                Category: Build
                Owner: AWS
                Provider: CodeBuild
                Version: '1'
              Configuration:
                ProjectName: !Ref TestProject
              InputArtifacts:
                - Name: ValidateOutput
              OutputArtifacts:
                - Name: TestOutput

        - Name: Deploy
          Actions:
            - Name: Deploy
              ActionTypeId:
                Category: Deploy
                Owner: AWS
                Provider: CodeDeploy
                Version: '1'
              Configuration:
                ApplicationName: !Ref ApplicationName
                DeploymentGroupName: !Ref DeploymentGroupName
              InputArtifacts:
                - Name: TestOutput

  SDDValidateProject:
    Type: AWS::CodeBuild::Project
    Properties:
      Name: SDD-Validate
      ServiceRole: !GetAtt CodeBuildRole.Arn
      Artifacts:
        Type: CODEPIPELINE
      Environment:
        Type: LINUX_CONTAINER
        Image: aws/codebuild/amazonlinux2-x86_64-standard:4.0
        ComputeType: BUILD_GENERAL1_SMALL
      Source:
        Type: CODEPIPELINE
        BuildSpec: |
          version: 0.2
          phases:
            install:
              runtime-versions:
                nodejs: 20
              commands:
                - npm ci
            build:
              commands:
                - echo "Validating SDD graph..."
                - npx opencode-telos validate
                - echo "Checking SDD drift..."
                - npx opencode-telos drift || true
                - echo "Checking SDD quality..."
                - npx opencode-telos quality || true

  TestProject:
    Type: AWS::CodeBuild::Project
    Properties:
      Name: SDD-Test
      ServiceRole: !GetAtt CodeBuildRole.Arn
      Artifacts:
        Type: CODEPIPELINE
      Environment:
        Type: LINUX_CONTAINER
        Image: aws/codebuild/amazonlinux2-x86_64-standard:4.0
        ComputeType: BUILD_GENERAL1_SMALL
      Source:
        Type: CODEPIPELINE
        BuildSpec: |
          version: 0.2
          phases:
            install:
              runtime-versions:
                nodejs: 20
              commands:
                - npm ci
            build:
              commands:
                - npm test

  ArtifactBucket:
    Type: AWS::S3::Bucket

  PipelineRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: codepipeline.amazonaws.com
            Action: sts:AssumeRole

  CodeBuildRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: codebuild.amazonaws.com
            Action: sts:AssumeRole

Parameters:
  RepositoryId:
    Type: String
    Description: 'GitHub repository ID (owner/repo)'
  GitHubConnection:
    Type: String
    Description: 'ARN of CodeStar connection to GitHub'
  ApplicationName:
    Type: String
    Description: 'Name of the application'
  DeploymentGroupName:
    Type: String
    Description: 'Name of the deployment group'
`;
    const filePath = join(config.projectDir, "buildspec.yml");
    return { platform: "AWS CodePipeline", file_path: filePath, content };
}
function generateTravisCI(config) {
    const content = `language: node_js

node_js:
  - '20'

cache:
  directories:
    - node_modules

branches:
  only:
    - main
    - develop

stages:
  - validate
  - test
  - build
  - name: deploy
    if: branch = main

jobs:
  include:
    - stage: validate
      script:
        - echo "Validating SDD graph..."
        - npx opencode-telos validate
        - echo "Checking SDD drift..."
        - npx opencode-telos drift || true
        - echo "Checking SDD quality..."
        - npx opencode-telos quality || true
        - echo "Detecting anti-patterns..."
        - npx opencode-telos anti-patterns || true

    - stage: test
      script:
        - npm test

    - stage: build
      script:
        - npm run build

    - stage: deploy
      script:
        - echo "Deploying with SDD validation..."
        - npx opencode-telos full-cycle

notifications:
  email:
    on_success: never
    on_failure: always
`;
    const filePath = join(config.projectDir, ".travis.yml");
    return { platform: "Travis CI", file_path: filePath, content };
}
function generateNpmPublish(config) {
    const content = `name: NPM Publish

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build
        run: npm run build

      - name: Validate SDD before publish
        run: |
          echo "Validating SDD graph before publish..."
          npx opencode-telos validate
          npx opencode-telos quality

      - name: Publish to NPM
        run: npm publish
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          files: |
            dist/**
            package.json
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
    const filePath = join(config.projectDir, ".github", "workflows", "npm-publish.yml");
    return { platform: "NPM Publish", file_path: filePath, content };
}
function generateDockerCompose(config) {
    const endpoints = getNodesByType(config.graph, "endpoint");
    const hasApi = endpoints.length > 0;
    const port = hasApi ? 3000 : 8080;
    const content = `version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "\${APP_PORT:-${port}}:${port}"
    environment:
      - NODE_ENV=\${NODE_ENV:-production}
      - DATABASE_URL=\${DATABASE_URL}
      - REDIS_URL=\${REDIS_URL:-redis://redis:6379}
    depends_on:
      - redis
      - db
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${port}/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - app-network

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped
    networks:
      - app-network

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=\${POSTGRES_DB:-app}
      - POSTGRES_USER=\${POSTGRES_USER:-postgres}
      - POSTGRES_PASSWORD=\${POSTGRES_PASSWORD:-secret}
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    restart: unless-stopped
    networks:
      - app-network

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - app
    restart: unless-stopped
    networks:
      - app-network

volumes:
  redis-data:
  postgres-data:

networks:
  app-network:
    driver: bridge
`;
    const filePath = join(config.projectDir, "docker-compose.yml");
    return { platform: "Docker Compose", file_path: filePath, content };
}
function generateMaven(config) {
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.example</groupId>
    <artifactId>sdd-project</artifactId>
    <version>1.0.0</version>
    <packaging>jar</packaging>

    <properties>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
            <version>3.2.0</version>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
            <version>3.2.0</version>
        </dependency>
        <dependency>
            <groupId>com.h2database</groupId>
            <artifactId>h2</artifactId>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>3.2.2</version>
            </plugin>
        </plugins>
    </build>

    <profiles>
        <profile>
            <id>sdd-validate</id>
            <build>
                <plugins>
                    <plugin>
                        <groupId>org.codehaus.mojo</groupId>
                        <artifactId>exec-maven-plugin</artifactId>
                        <version>3.1.0</version>
                        <executions>
                            <execution>
                                <id>sdd-validate</id>
                                <phase>validate</phase>
                                <goals>
                                    <goal>exec</goal>
                                </goals>
                                <configuration>
                                    <executable>npx</executable>
                                    <arguments>
                                        <argument>opencode-telos</argument>
                                        <argument>validate</argument>
                                    </arguments>
                                </configuration>
                            </execution>
                        </executions>
                    </plugin>
                </plugins>
            </build>
        </profile>
    </profiles>
</project>
`;
    const filePath = join(config.projectDir, "pom.xml");
    return { platform: "Maven (Java)", file_path: filePath, content };
}
function generatePip(config) {
    const content = `name: Python CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ['3.10', '3.11', '3.12']

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python \${{ matrix.python-version }}
        uses: actions/setup-python@v5
        with:
          python-version: \${{ matrix.python-version }}

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
          pip install -r requirements-dev.txt

      - name: Lint with flake8
        run: |
          flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics
          flake8 . --count --max-complexity=10 --max-line-length=127 --statistics

      - name: Test with pytest
        run: |
          pytest --cov=src --cov-report=xml

      - name: Validate SDD
        run: |
          echo "Validating SDD graph..."
          npx opencode-telos validate
          npx opencode-telos quality

  publish:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install build dependencies
        run: |
          python -m pip install --upgrade pip
          pip install build twine

      - name: Build package
        run: python -m build

      - name: Publish to PyPI
        uses: pypa/gh-action-pypi-publish@release/v1
        with:
          password: \${{ secrets.PYPI_API_TOKEN }}
`;
    const filePath = join(config.projectDir, ".github", "workflows", "python-ci.yml");
    return { platform: "Python (pip)", file_path: filePath, content };
}
function generateGoReleaser(config) {
    const content = `name: Go Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.21'

      - name: Run tests
        run: go test ./...

      - name: Validate SDD
        run: |
          echo "Validating SDD graph..."
          npx opencode-telos validate

  release:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.21'

      - name: Run GoReleaser
        uses: goreleaser/goreleaser-action@v5
        with:
          distribution: goreleaser
          version: latest
          args: release --clean
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
    const filePath = join(config.projectDir, ".github", "workflows", "go-release.yml");
    return { platform: "Go (GoReleaser)", file_path: filePath, content };
}
const generators = {
    github: generateGitHubActions,
    gitlab: generateGitLabCI,
    jenkins: generateJenkins,
    docker: generateDocker,
    circleci: generateCircleCI,
    azure: generateAzureDevOps,
    aws: generateAWSCodePipeline,
    travis: generateTravisCI,
    npm: generateNpmPublish,
    compose: generateDockerCompose,
    maven: generateMaven,
    pip: generatePip,
    go: generateGoReleaser,
};
export function writeCicdFiles(results, projectDir) {
    const written = [];
    for (const result of results) {
        const safePath = projectDir ? projectPath(projectDir, result.file_path, true) : result.file_path;
        const dir = dirname(safePath);
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        atomicWriteFile(safePath, result.content);
        written.push(safePath);
    }
    return written;
}
export function formatCicdResults(results) {
    const lines = [
        "## CI/CD Configuration Generated",
        "",
    ];
    for (const result of results) {
        lines.push(`### ${result.platform}`);
        lines.push(`- File: \`${result.file_path}\``);
        lines.push(`- Size: ${result.content.length} bytes`);
        lines.push("");
    }
    lines.push("### SDD Validation Steps Included");
    lines.push("- Graph validation");
    lines.push("- Drift detection");
    lines.push("- Quality scoring");
    lines.push("- Anti-pattern detection");
    lines.push("- Test coverage check");
    lines.push("- Contradiction detection");
    return lines.join("\n");
}
