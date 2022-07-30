import {
	CfnOutput,
	Duration,
	Expiration,
	RemovalPolicy,
	Stack,
	StackProps,
} from 'aws-cdk-lib'
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb'
import { Construct } from 'constructs'
import {
	GraphqlApi,
	Schema,
	AuthorizationType,
	FieldLogLevel,
	MappingTemplate,
} from '@aws-cdk/aws-appsync-alpha'
import * as path from 'path'
import { Schedule, Rule } from 'aws-cdk-lib/aws-events'
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets'
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda'

export class GuestUserBackendStack extends Stack {
	constructor(scope: Construct, id: string, props?: StackProps) {
		super(scope, id, props)

		const userTable = new Table(this, 'User Table', {
			removalPolicy: RemovalPolicy.DESTROY,
			billingMode: BillingMode.PAY_PER_REQUEST,
			partitionKey: { name: 'userId', type: AttributeType.STRING },
		})

		const api = new GraphqlApi(this, 'Book API', {
			name: 'Book API',
			schema: Schema.fromAsset(path.join(__dirname, 'schema.graphql')),
			authorizationConfig: {
				defaultAuthorization: {
					authorizationType: AuthorizationType.API_KEY,
					apiKeyConfig: {
						description: 'public scan for books',
						expires: Expiration.after(Duration.days(30)),
						name: 'Public Book Scan Token',
					},
				},
			},
			logConfig: {
				fieldLogLevel: FieldLogLevel.ALL,
			},
			xrayEnabled: true,
		})

		api.addDynamoDbDataSource('listUsers', userTable).createResolver({
			typeName: 'Query',
			fieldName: 'listUsers',
			requestMappingTemplate: MappingTemplate.fromFile(
				path.join(__dirname, 'mappingTemplates/Query.listUsers.req.vtl')
			),
			responseMappingTemplate: MappingTemplate.fromFile(
				path.join(__dirname, 'mappingTemplates/Query.listUsers.res.vtl')
			),
		})

		const addUserLambda = new Function(this, 'addUserFunction', {
			runtime: Runtime.NODEJS_16_X,
			handler: 'index.main',
			code: Code.fromAsset(path.join(__dirname, 'functions/addUserLambda')),
			environment: {
				TABLENAME: userTable.tableName,
			},
		})

		userTable.grantWriteData(addUserLambda)

		new Rule(this, 'addUserRule', {
			schedule: Schedule.rate(Duration.minutes(5)),
			targets: [new LambdaFunction(addUserLambda)],
		})

		new CfnOutput(this, 'GraphQLAPIID', {
			value: api.apiId,
		})

		new CfnOutput(this, 'GraphQLAPIKey', {
			value: api.apiKey || '',
		})
	}
}
