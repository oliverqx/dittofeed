import { Type, TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import prisma, { Prisma } from "backend-lib/src/prisma";
import { UserProperty } from "backend-lib/src/types";
import { findAllPropertyValues, findAllUserProperties, findAllUserPropertyResources } from "backend-lib/src/userProperties";
import { FastifyInstance } from "fastify";
import protectedUserProperties from "isomorphic-lib/src/protectedUserProperties";
import { schemaValidate } from "isomorphic-lib/src/resultHandling/schemaValidation";
import {
  DeleteUserPropertyRequest,
  EmptyResponse,
  GetComputedPropertyAssignmentResourcesResponse,
  GetUserPropertiesResponse,
  UpsertUserPropertyResource,
  UserPropertyDefinition,
  UserPropertyResource,
} from "isomorphic-lib/src/types";

// eslint-disable-next-line @typescript-eslint/require-await
export default async function userPropertiesController(
  fastify: FastifyInstance,
) {
  fastify.withTypeProvider<TypeBoxTypeProvider>().put(
    "/",
    {
      schema: {
        description: "Create or update a user property.",
        tags: ["User Properties"],
        body: UpsertUserPropertyResource,
        response: {
          200: UserPropertyResource,
        },
      },
    },
    async (request, reply) => {
      let userProperty: UserProperty;
      const { id, name, definition, workspaceId, exampleValue } = request.body;

      const canCreate = workspaceId && name && definition;
      const definitionUpdatedAt = definition ? new Date() : undefined;

      if (protectedUserProperties.has(name)) {
        return reply.status(400).send();
      }

      if (canCreate && id) {
        userProperty = await prisma().userProperty.upsert({
          where: {
            id,
          },
          create: {
            id,
            workspaceId,
            name,
            definition,
            exampleValue,
          },
          update: {
            workspaceId,
            name,
            definition,
            definitionUpdatedAt,
            exampleValue,
          },
        });
      } else {
        userProperty = await prisma().userProperty.update({
          where: {
            id,
          },
          data: {
            workspaceId,
            name,
            definition,
            exampleValue,
            definitionUpdatedAt,
          },
        });
      }

      const userPropertyDefinitionResult = schemaValidate(
        userProperty.definition,
        UserPropertyDefinition,
      );

      if (userPropertyDefinitionResult.isErr()) {
        // TODO add logging
        return reply.status(500).send();
      }
      const resource: UserPropertyResource = {
        id: userProperty.id,
        name: userProperty.name,
        workspaceId: userProperty.workspaceId,
        definition: userPropertyDefinitionResult.value,
        exampleValue: userProperty.exampleValue ?? undefined,
      };

      return reply.status(200).send(resource);
    },
  );

 fastify.withTypeProvider<TypeBoxTypeProvider>().get(
      "/values",
      {
          schema: {
              description: "Get all properties values",
              tags: ["User Properties"],
              querystring: Type.Object({
                  propertyId: Type.String(),
                  workspaceId: Type.String()
              }),
              response: {
                200: GetComputedPropertyAssignmentResourcesResponse,
                500: {},
              },
          },
      },
    async (request, reply) => {
      try {
        const result = await findAllPropertyValues({
            propertyId: request.query.propertyId,
            workspaceId: request.query.workspaceId
        })

        return reply.status(200).send({
            values: result
        })
      } catch (e) {
            throw e;
      }
    }
  )


   fastify.withTypeProvider<TypeBoxTypeProvider>().get(
      "/",
      {
          schema: {
              description: "Get all user properties",
              tags: ["User Properties"],
              querystring: Type.Object({
                  workspaceId: Type.String(),
              }),
              response: {
                200: GetUserPropertiesResponse,
                500: {},
              },
          },
      },
    async (request, reply) => {
      try {
        const properties = await findAllUserProperties({workspaceId: request.query.workspaceId}); 

        return reply.status(200).send({
            properties: properties
        })
      } catch (e) {
            throw e;
      }
    }
  )


  fastify.withTypeProvider<TypeBoxTypeProvider>().delete(
    "/",
    {
      schema: {
        description: "Delete a user property.",
        tags: ["User Properties"],
        body: DeleteUserPropertyRequest,
        response: {
          204: EmptyResponse,
          404: {},
        },
      },
    },
    async (request, reply) => {
      const { id } = request.body;

      let deletedCount: number;
      try {
        await prisma().userPropertyAssignment.deleteMany({
          where: {
            AND: [
              {
                userPropertyId: id,
              },
              {
                userProperty: {
                  name: {
                    notIn: Array.from(protectedUserProperties),
                  },
                },
              },
            ],
          },
        });
        const response = await prisma().userProperty.deleteMany({
          where: {
            AND: [
              {
                id,
              },
              {
                name: {
                  notIn: Array.from(protectedUserProperties),
                },
              },
            ],
          },
        });
        deletedCount = response.count;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError) {
          switch (e.code) {
            case "P2025":
              return reply.status(404).send();
            case "P2023":
              return reply.status(404).send();
          }
        }
        throw e;
      }

      if (deletedCount <= 0) {
        return reply.status(404).send();
      }

      return reply.status(204).send();
    },
  );
}
