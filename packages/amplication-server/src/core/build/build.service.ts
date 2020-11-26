import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, MethodNotSupported } from '@slynova/flydrive';
import { GoogleCloudStorage } from '@slynova/flydrive-gcs';
import { StorageService } from '@codebrew/nestjs-storage';
import { subSeconds } from 'date-fns';

import { PrismaService } from 'nestjs-prisma';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import * as winston from 'winston';
import { LEVEL, MESSAGE, SPLAT } from 'triple-beam';
import omit from 'lodash.omit';
import path from 'path';
import * as DataServiceGenerator from 'amplication-data-service-generator';
import { ContainerBuilderService } from 'amplication-container-builder/dist/nestjs';
import {
  BuildResult,
  EnumBuildStatus as ContainerBuildStatus
} from 'amplication-container-builder/dist/';
import { AppRole } from 'src/models';
import { Build } from './dto/Build';
import { CreateBuildArgs } from './dto/CreateBuildArgs';
import { FindManyBuildArgs } from './dto/FindManyBuildArgs';
import { getBuildZipFilePath, getBuildTarGzFilePath } from './storage';
import { EnumBuildStatus } from './dto/EnumBuildStatus';
import { FindOneBuildArgs } from './dto/FindOneBuildArgs';
import { BuildNotFoundError } from './errors/BuildNotFoundError';
import { EntityService } from '..';
import { BuildNotCompleteError } from './errors/BuildNotCompleteError';
import { BuildResultNotFound } from './errors/BuildResultNotFound';
import { EnumActionStepStatus } from '../action/dto/EnumActionStepStatus';
import { EnumActionLogLevel } from '../action/dto/EnumActionLogLevel';
import { AppRoleService } from '../appRole/appRole.service';
import { AppService } from '../app/app.service'; // eslint-disable-line import/no-cycle
import { ActionService } from '../action/action.service';
import { ActionStep } from '../action/dto';
import { createZipFileFromModules } from './zip';
import { LocalDiskService } from '../storage/local.disk.service';
import { createTarGzFileFromModules } from './tar';
import { Deployment } from '../deployment/dto/Deployment';
import { DeploymentService } from '../deployment/deployment.service';
import { FindManyDeploymentArgs } from '../deployment/dto/FindManyDeploymentArgs';

export const GENERATED_APP_BASE_IMAGE_VAR = 'GENERATED_APP_BASE_IMAGE';
export const GENERATED_APP_BASE_IMAGE_BUILD_ARG = 'IMAGE';
export const GENERATE_STEP_MESSAGE = 'Generating Application';
export const GENERATE_STEP_NAME = 'GENERATE_APPLICATION';
export const BUILD_DOCKER_IMAGE_STEP_MESSAGE = 'Building Docker image';
export const BUILD_DOCKER_IMAGE_STEP_NAME = 'BUILD_DOCKER';
export const BUILD_DOCKER_IMAGE_STEP_FINISH_LOG =
  'Built Docker image successfully';
export const BUILD_DOCKER_IMAGE_STEP_FAILED_LOG = 'Build Docker failed';
export const BUILD_DOCKER_IMAGE_STEP_RUNNING_LOG =
  'Waiting for Docker image...';
export const BUILD_DOCKER_IMAGE_STEP_START_LOG =
  'Starting to build Docker image. It should take around 2 minutes.';

export const ACTION_ZIP_LOG = 'Creating ZIP file';
export const ACTION_JOB_DONE_LOG = 'Build job done';
export const JOB_STARTED_LOG = 'Build job started';
export const JOB_DONE_LOG = 'Build job done';
export const ENTITIES_INCLUDE = {
  fields: true,
  permissions: {
    include: {
      permissionRoles: {
        include: {
          appRole: true
        }
      },
      permissionFields: {
        include: {
          field: true,
          permissionRoles: {
            include: {
              appRole: true
            }
          }
        }
      }
    }
  }
};

const WINSTON_LEVEL_TO_ACTION_LOG_LEVEL: {
  [level: string]: EnumActionLogLevel;
} = {
  error: EnumActionLogLevel.Error,
  warn: EnumActionLogLevel.Warning,
  info: EnumActionLogLevel.Info,
  debug: EnumActionLogLevel.Debug
};

const WINSTON_META_KEYS_TO_OMIT = [LEVEL, MESSAGE, SPLAT, 'level'];

export function createInitialStepData(version: string, message: string) {
  return {
    message: 'Adding task to queue',
    name: 'ADD_TO_QUEUE',
    status: EnumActionStepStatus.Success,
    completedAt: new Date(),
    logs: {
      create: [
        {
          level: EnumActionLogLevel.Info,
          message: 'create build generation task',
          meta: {}
        },
        {
          level: EnumActionLogLevel.Info,
          message: `Build Version: ${version}`,
          meta: {}
        },
        {
          level: EnumActionLogLevel.Info,
          message: `Build message: ${message}`,
          meta: {}
        }
      ]
    }
  };
}

const CONTAINER_STATUS_UPDATE_INTERVAL_SEC = 10;

@Injectable()
export class BuildService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
    private readonly entityService: EntityService,
    private readonly appRoleService: AppRoleService,
    private readonly actionService: ActionService,
    private readonly containerBuilderService: ContainerBuilderService,
    private readonly localDiskService: LocalDiskService,
    private readonly deploymentService: DeploymentService,
    @Inject(forwardRef(() => AppService))
    private readonly appService: AppService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: winston.Logger
  ) {
    /** @todo move this to storageService config once possible */
    this.storageService.registerDriver('gcs', GoogleCloudStorage);
  }

  async create(args: CreateBuildArgs): Promise<Build> {
    const appId = args.data.app.connect.id;

    /**@todo: set version based on release when applicable */
    const commitId = args.data.commit.connect.id;
    const version = commitId.slice(commitId.length - 8);

    const latestEntityVersions = await this.entityService.getLatestVersions({
      where: { app: { id: appId } }
    });

    const build = await this.prisma.build.create({
      ...args,
      data: {
        ...args.data,
        version,

        createdAt: new Date(),
        blockVersions: {
          connect: []
        },
        entityVersions: {
          connect: latestEntityVersions.map(version => ({ id: version.id }))
        },
        action: {
          create: {
            steps: {
              create: createInitialStepData(version, args.data.message)
            }
          } //create action record
        }
      }
    });

    const logger = this.logger.child({
      buildId: build.id
    });
    logger.info(JOB_STARTED_LOG);
    const tarballURL = await this.generate(build);
    await this.buildDockerImage(build, tarballURL);
    logger.info(JOB_DONE_LOG);

    return build;
  }

  async findMany(args: FindManyBuildArgs): Promise<Build[]> {
    return this.prisma.build.findMany(args);
  }

  async findOne(args: FindOneBuildArgs): Promise<Build | null> {
    return this.prisma.build.findOne(args);
  }

  /**
   * Gets the updated status of running "build container" tasks from
   * containerBuilderService, and updates the step status. This function should
   * be called periodically from an external scheduler
   */
  async updateRunningBuildsStatus(): Promise<void> {
    const lastUpdateThreshold = subSeconds(
      new Date(),
      CONTAINER_STATUS_UPDATE_INTERVAL_SEC
    );

    // find all builds that have a running "build docker" step
    const builds = await this.prisma.build.findMany({
      where: {
        containerStatusUpdatedAt: {
          lt: lastUpdateThreshold
        },
        action: {
          steps: {
            some: {
              status: {
                equals: EnumActionStepStatus.Running
              },
              name: {
                equals: BUILD_DOCKER_IMAGE_STEP_NAME
              }
            }
          }
        }
      },
      include: {
        action: {
          include: {
            steps: true
          }
        }
      }
    });
    await Promise.all(
      builds.map(async build => {
        const stepBuildDocker = build.action.steps.find(
          step => step.name === BUILD_DOCKER_IMAGE_STEP_NAME
        );
        try {
          const result = await this.containerBuilderService.getStatus(
            build.containerStatusQuery
          );
          await this.handleContainerBuilderResult(
            build,
            stepBuildDocker,
            result
          );
        } catch (error) {
          await this.actionService.logInfo(stepBuildDocker, error);
          await this.actionService.complete(
            stepBuildDocker,
            EnumActionStepStatus.Failed
          );
        }
      })
    );
  }

  async calcBuildStatus(buildId): Promise<EnumBuildStatus> {
    const build = await this.prisma.build.findOne({
      where: {
        id: buildId
      },
      include: {
        action: {
          include: {
            steps: true
          }
        }
      }
    });

    if (!build.action?.steps?.length) return EnumBuildStatus.Invalid;
    const steps = build.action.steps;

    if (steps.every(step => step.status === EnumActionStepStatus.Success))
      return EnumBuildStatus.Completed;

    if (steps.some(step => step.status === EnumActionStepStatus.Failed))
      return EnumBuildStatus.Failed;

    return EnumBuildStatus.Running;
  }

  async download(args: FindOneBuildArgs): Promise<NodeJS.ReadableStream> {
    const build = await this.findOne(args);
    const { id } = args.where;
    if (build === null) {
      throw new BuildNotFoundError(id);
    }
    const status = await this.calcBuildStatus(build.id);
    if (status !== EnumBuildStatus.Completed) {
      throw new BuildNotCompleteError(id, status);
    }
    const filePath = getBuildZipFilePath(id);
    const disk = this.storageService.getDisk();
    const { exists } = await disk.exists(filePath);
    if (!exists) {
      throw new BuildResultNotFound(build.id);
    }
    return disk.getStream(filePath);
  }

  /**
   * Generates code for given build and saves it to storage
   * @param build build to generate code for
   */
  private async generate(build: Build): Promise<string> {
    return this.actionService.run(
      build.actionId,
      GENERATE_STEP_NAME,
      GENERATE_STEP_MESSAGE,
      async step => {
        const entities = await this.getEntities(build.id);
        const roles = await this.getAppRoles(build);
        const app = await this.appService.app({ where: { id: build.appId } });
        const [
          dataServiceGeneratorLogger,
          logPromises
        ] = this.createDataServiceLogger(build, step);

        const modules = await DataServiceGenerator.createDataService(
          entities,
          roles,
          {
            name: app.name,
            description: app.description,
            version: build.version
          },
          dataServiceGeneratorLogger
        );

        await Promise.all(logPromises);

        dataServiceGeneratorLogger.destroy();

        await this.actionService.logInfo(step, ACTION_ZIP_LOG);

        const tarballURL = await this.save(build, modules);

        await this.actionService.logInfo(step, ACTION_JOB_DONE_LOG);

        return tarballURL;
      }
    );
  }

  /**
   * Builds Docker image for given build
   * Assuming build code was generated
   * @param build build to build docker image for
   */
  private async buildDockerImage(
    build: Build,
    tarballURL: string
  ): Promise<void> {
    const generatedAppBaseImage = this.configService.get(
      GENERATED_APP_BASE_IMAGE_VAR
    );
    return this.actionService.run(
      build.actionId,
      BUILD_DOCKER_IMAGE_STEP_NAME,
      BUILD_DOCKER_IMAGE_STEP_MESSAGE,
      async step => {
        await this.actionService.logInfo(
          step,
          BUILD_DOCKER_IMAGE_STEP_START_LOG
        );

        const result = await this.containerBuilderService.build(
          build.appId,
          build.id,
          tarballURL,
          {
            [GENERATED_APP_BASE_IMAGE_BUILD_ARG]: generatedAppBaseImage
          }
        );
        await this.handleContainerBuilderResult(build, step, result);
      },
      true
    );
  }

  async handleContainerBuilderResult(
    build: Build,
    step: ActionStep,
    result: BuildResult
  ) {
    switch (result.status) {
      case ContainerBuildStatus.Completed:
        await this.actionService.logInfo(
          step,
          BUILD_DOCKER_IMAGE_STEP_FINISH_LOG,
          {
            images: result.images
          }
        );
        await this.actionService.complete(step, EnumActionStepStatus.Success);

        await this.prisma.build.update({
          where: { id: build.id },
          data: {
            images: {
              set: result.images
            }
          }
        });
        await this.deploymentService.autoDeployToSandbox(build);
        break;
      case ContainerBuildStatus.Failed:
        await this.actionService.logInfo(
          step,
          BUILD_DOCKER_IMAGE_STEP_FAILED_LOG
        );
        await this.actionService.complete(step, EnumActionStepStatus.Failed);
        break;
      default:
        await this.actionService.logInfo(
          step,
          BUILD_DOCKER_IMAGE_STEP_RUNNING_LOG
        );
        await this.prisma.build.update({
          where: { id: build.id },
          data: {
            containerStatusQuery: result.statusQuery,
            containerStatusUpdatedAt: new Date()
          }
        });
        break;
    }
  }

  async getDeployments(
    buildId: string,
    args: FindManyDeploymentArgs
  ): Promise<Deployment[]> {
    return this.deploymentService.findMany({
      ...args,
      where: { ...args?.where, build: { id: buildId } }
    });
  }

  private async getAppRoles(build: Build): Promise<AppRole[]> {
    return this.appRoleService.getAppRoles({
      where: {
        app: {
          id: build.appId
        }
      }
    });
  }

  private createDataServiceLogger(
    build: Build,
    step: ActionStep
  ): [winston.Logger, Array<Promise<void>>] {
    const transport = new winston.transports.Console();
    const logPromises: Array<Promise<void>> = [];
    transport.on('logged', info => {
      logPromises.push(this.createLog(step, info));
    });
    return [
      winston.createLogger({
        format: this.logger.format,
        transports: [transport],
        defaultMeta: {
          buildId: build.id
        }
      }),
      logPromises
    ];
  }

  /**
   * Saves given modules for given build as a Zip archive and tarball.
   * @param build the build to save the modules for
   * @param modules the modules to save
   * @returns created tarball URL
   */
  private async save(
    build: Build,
    modules: DataServiceGenerator.Module[]
  ): Promise<string> {
    const zipFilePath = getBuildZipFilePath(build.id);
    const tarFilePath = getBuildTarGzFilePath(build.id);
    const disk = this.storageService.getDisk();
    await Promise.all([
      createZipFileFromModules(modules).then(zip => disk.put(zipFilePath, zip)),
      createTarGzFileFromModules(modules).then(tar =>
        disk.put(tarFilePath, tar)
      )
    ]);
    return this.getFileURL(disk, tarFilePath);
  }

  /** @todo move */
  private getFileURL(disk: Storage, filePath: string) {
    try {
      return disk.getUrl(filePath);
    } catch (error) {
      if (error instanceof MethodNotSupported) {
        const root = this.localDiskService.getDisk().config.root;
        return path.join(root, filePath);
      }
      throw error;
    }
  }

  private async createLog(
    step: ActionStep,
    info: { message: string }
  ): Promise<void> {
    const { message, ...winstonMeta } = info;
    const level = WINSTON_LEVEL_TO_ACTION_LOG_LEVEL[info[LEVEL]];
    const meta = omit(winstonMeta, WINSTON_META_KEYS_TO_OMIT);

    await this.actionService.log(step, level, message, meta);
  }

  private async getEntities(
    buildId: string
  ): Promise<DataServiceGenerator.Entity[]> {
    const entities = await this.entityService.getEntitiesByVersions({
      where: {
        builds: {
          some: {
            id: buildId
          }
        }
      },
      include: ENTITIES_INCLUDE
    });
    return entities as DataServiceGenerator.Entity[];
  }
}
