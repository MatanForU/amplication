import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { BuildService } from './build.service';
import { QUEUE_NAME } from './constants';

const EXAMPLE_APP_ID = 'ExampleAppId';

const EXAMPLE_ENTITIES = [];

const addMock = jest.fn(() => {
  return;
});

const entitiesMock = jest.fn(() => {
  return EXAMPLE_ENTITIES;
});

describe('BuildService', () => {
  let service: BuildService;

  jest.clearAllMocks();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuildService,
        {
          provide: getQueueToken(QUEUE_NAME),
          useValue: {
            add: addMock
          }
        }
      ]
    }).compile();

    service = module.get<BuildService>(BuildService);
  });

  test('should be defined', () => {
    expect(service).toBeDefined();
  });

  test('create', async () => {
    const args = { app: { id: EXAMPLE_APP_ID } };
    expect(await service.create(args));
    expect(entitiesMock).toBeCalledTimes(1);
    expect(entitiesMock).toBeCalledWith({ where: args });
    expect(addMock).toBeCalledTimes(1);
    expect(addMock).toBeCalledWith({ entities: EXAMPLE_ENTITIES });
  });
});
